//! What a file or link is, from its name, its first bytes, and its URL shape. Pure.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// A Windows program (.exe, .bat, .lnk) or installer (.msi), run with Wine.
    Windows {
        path: PathBuf,
        installer: bool,
    },
    /// A .flatpakref file (Flathub's "Install" button downloads one).
    FlatpakRef(PathBuf),
    /// A .flatpakrepo file: adds a Flatpak remote.
    FlatpakRepo(PathBuf),
    /// A .flatpak bundle file.
    FlatpakBundle(PathBuf),
    /// An app on Flathub by id, from a flathub.org link or an appstream:// URL.
    FlathubApp(String),
    AppImage(PathBuf),
    /// An Arch Linux package (.pkg.tar.zst/.xz).
    ArchPackage(PathBuf),
    /// A Debian/Ubuntu or Fedora package, which Arch can't install directly.
    ForeignPackage {
        path: PathBuf,
        kind: &'static str,
    },
    /// An Android app, run with Waydroid.
    Android(PathBuf),
    /// Anything else: the normal handler (xdg-open).
    Other(String),
}

/// Flathub app ids look like reverse domain names: org.gimp.GIMP, com.spotify.Client.
pub fn is_app_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    parts.len() >= 3
        && id.len() <= 255
        && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'))
        && !parts[0].starts_with(|c: char| c.is_ascii_digit())
}

fn flathub_id(url: &str) -> Option<String> {
    let rest = url.strip_prefix("appstream://").or_else(|| url.strip_prefix("appstream:")).map(str::to_string).or_else(|| {
        let without = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
        let without = without.strip_prefix("www.").unwrap_or(without);
        let path = without.strip_prefix("flathub.org/")?;
        // flathub.org/apps/<id>, /<lang>/apps/<id>, /apps/details/<id>
        let segments: Vec<&str> = path.split(['?', '#']).next()?.split('/').filter(|s| !s.is_empty()).collect();
        let at = segments.iter().position(|s| *s == "apps")?;
        let next = segments.get(at + 1)?;
        let id = if *next == "details" { segments.get(at + 2)? } else { next };
        Some(id.to_string())
    })?;
    let id = rest.trim_end_matches('/').trim_end_matches(".desktop").to_string();
    is_app_id(&id).then_some(id)
}

fn lower_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// `head` is the first bytes of the file (at least 16 when it has them), for magic numbers.
pub fn classify(input: &str, head: &[u8]) -> Target {
    if let Some(id) = flathub_id(input) {
        return Target::FlathubApp(id);
    }
    let path_str = input.strip_prefix("file://").unwrap_or(input);
    if path_str.contains("://") {
        return Target::Other(input.to_string());
    }
    let path = PathBuf::from(path_str);
    let name = lower_name(&path);
    let ext = |e: &str| name.ends_with(e);
    let pe = head.starts_with(b"MZ");
    // AppImage type 1 and 2 put "AI" and the type byte at offset 8 of an ELF file.
    let appimage = head.len() >= 11 && head.starts_with(b"\x7fELF") && &head[8..10] == b"AI" && (head[10] == 1 || head[10] == 2);
    if ext(".msi") {
        Target::Windows { path, installer: true }
    } else if ext(".exe") || ext(".bat") || ext(".lnk") || ext(".com") || (pe && !ext(".dll")) {
        let installer = ["setup", "install", "installer"].iter().any(|w| name.contains(w));
        Target::Windows { path, installer }
    } else if ext(".flatpakref") {
        Target::FlatpakRef(path)
    } else if ext(".flatpakrepo") {
        Target::FlatpakRepo(path)
    } else if ext(".flatpak") {
        Target::FlatpakBundle(path)
    } else if ext(".appimage") || appimage {
        Target::AppImage(path)
    } else if ext(".pkg.tar.zst") || ext(".pkg.tar.xz") || ext(".pkg.tar.gz") {
        Target::ArchPackage(path)
    } else if ext(".deb") {
        Target::ForeignPackage { path, kind: "Debian/Ubuntu" }
    } else if ext(".rpm") {
        Target::ForeignPackage { path, kind: "Fedora" }
    } else if ext(".apk") || ext(".xapk") {
        Target::Android(path)
    } else {
        Target::Other(input.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    #[test]
    fn flathub_links_and_appstream() {
        for url in [
            "https://flathub.org/apps/com.spotify.Client",
            "https://flathub.org/en/apps/com.spotify.Client",
            "https://www.flathub.org/apps/details/com.spotify.Client",
            "https://flathub.org/apps/com.spotify.Client?ref=x",
            "appstream://com.spotify.Client",
            "appstream:com.spotify.Client.desktop",
        ] {
            assert_eq!(classify(url, b""), Target::FlathubApp("com.spotify.Client".into()), "{url}");
        }
        assert_eq!(classify("https://flathub.org/apps/search?q=x", b""), Target::Other("https://flathub.org/apps/search?q=x".into()));
        assert!(matches!(classify("appstream://rm -rf", b""), Target::Other(_)));
        assert!(matches!(classify("https://example.com/app.exe", b""), Target::Other(_)));
    }

    #[test]
    fn files_by_name_and_magic() {
        assert_eq!(classify("/d/Setup.exe", b"MZ"), Target::Windows { path: p("/d/Setup.exe"), installer: true });
        assert_eq!(classify("/d/game.EXE", b"MZ"), Target::Windows { path: p("/d/game.EXE"), installer: false });
        assert_eq!(classify("/d/thing.msi", b""), Target::Windows { path: p("/d/thing.msi"), installer: true });
        assert_eq!(classify("file:///d/noext", b"MZ\x90\x00"), Target::Windows { path: p("/d/noext"), installer: false });
        assert_eq!(classify("/d/spotify.flatpakref", b""), Target::FlatpakRef(p("/d/spotify.flatpakref")));
        assert_eq!(classify("/d/x.flatpak", b""), Target::FlatpakBundle(p("/d/x.flatpak")));
        let mut elf = b"\x7fELF\x02\x01\x01\x00AI\x02".to_vec();
        elf.resize(16, 0);
        assert_eq!(classify("/d/tool", &elf), Target::AppImage(p("/d/tool")));
        assert_eq!(classify("/d/Tool-x86_64.AppImage", b""), Target::AppImage(p("/d/Tool-x86_64.AppImage")));
        assert_eq!(classify("/d/yay-12.pkg.tar.zst", b""), Target::ArchPackage(p("/d/yay-12.pkg.tar.zst")));
        assert_eq!(classify("/d/code.deb", b""), Target::ForeignPackage { path: p("/d/code.deb"), kind: "Debian/Ubuntu" });
        assert_eq!(classify("/d/app.apk", b"PK"), Target::Android(p("/d/app.apk")));
        assert_eq!(classify("/d/notes.txt", b"hello"), Target::Other("/d/notes.txt".into()));
    }

    #[test]
    fn app_ids() {
        assert!(is_app_id("org.gimp.GIMP"));
        assert!(is_app_id("io.github.some_one.App-Name"));
        assert!(!is_app_id("gimp"));
        assert!(!is_app_id("org..x"));
        assert!(!is_app_id("org.x.y z"));
    }
}
