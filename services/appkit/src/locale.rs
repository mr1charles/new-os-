//! The user's language: `~/.config/locale.conf` (the systemd format, read at login by
//! /etc/profile.d/locale.sh), set by Setup and Settings. Takes effect at the next login.

use std::path::{Path, PathBuf};

use crate::{AppError, Result};

/// `~/.config/locale.conf` (not in HelixOS's own folder: the system reads it at login).
pub fn locale_file() -> PathBuf {
    let helixos = crate::paths::config_dir();
    helixos.parent().map(Path::to_path_buf).unwrap_or(helixos).join("locale.conf")
}

/// "en_US.UTF-8", "pt_BR.UTF-8", "ast_ES.UTF-8".
pub fn valid(lang: &str) -> bool {
    let Some(base) = lang.strip_suffix(".UTF-8") else { return false };
    let Some((language, region)) = base.split_once('_') else { return false };
    (2..=3).contains(&language.len())
        && language.chars().all(|c| c.is_ascii_lowercase())
        && region.len() == 2
        && region.chars().all(|c| c.is_ascii_uppercase())
}

/// The LANG set in the file, if any.
pub fn read(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    text.lines().find_map(|line| line.trim().strip_prefix("LANG=")).map(|v| v.trim_matches('"').to_string())
}

/// Set LANG, keeping any other settings (LC_TIME=...) already in the file.
pub fn write(path: &Path, lang: &str) -> Result<()> {
    if !valid(lang) {
        return Err(AppError::Invalid(format!("not a language: {lang}")));
    }
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    let mut lines: Vec<String> = existing.lines().filter(|l| !l.trim().starts_with("LANG=")).map(str::to_string).collect();
    lines.insert(0, format!("LANG={lang}"));
    crate::write_atomic(path, (lines.join("\n") + "\n").as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_languages() {
        assert!(valid("en_US.UTF-8"));
        assert!(valid("ast_ES.UTF-8"));
        assert!(!valid("en_US"));
        assert!(!valid("EN_us.UTF-8"));
        assert!(!valid("en_US.UTF-8; rm -rf /"));
    }

    #[test]
    fn writes_and_reads_keeping_other_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("locale.conf");
        assert_eq!(read(&path), None);
        std::fs::write(&path, "LANG=en_US.UTF-8\nLC_TIME=en_GB.UTF-8\n").unwrap();
        write(&path, "fr_FR.UTF-8").unwrap();
        assert_eq!(read(&path).as_deref(), Some("fr_FR.UTF-8"));
        assert!(std::fs::read_to_string(&path).unwrap().contains("LC_TIME=en_GB.UTF-8"));
        assert!(write(&path, "bad").is_err());
    }
}
