//! What to do for each kind of target: a question to ask first (if any), the steps, and what
//! to open afterwards. Pure: the steps are data, run by `main.rs`.

use std::path::{Path, PathBuf};

use crate::classify::Target;

/// Which helpers are installed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Available {
    pub wine: bool,
    pub flatpak: bool,
    pub waydroid: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Run and wait; failure stops the plan.
    Run(Vec<String>),
    /// Run as administrator (pkexec shows the password prompt).
    Admin(Vec<String>),
    /// Move an AppImage into ~/Applications, make it executable, and add it to the apps.
    AddAppImage(PathBuf),
    /// Make a file executable where it is.
    MakeExecutable(PathBuf),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Question {
    pub title: String,
    pub body: String,
    /// (action id, label). The first is the main one.
    pub actions: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    pub question: Option<Question>,
    /// Shown in the Dynamic Island while the steps run.
    pub activity: String,
    pub steps: Vec<Step>,
    /// Started when the steps are done (detached).
    pub open: Option<Vec<String>>,
    /// Open right away when done; otherwise the done notification offers an "Open" button.
    pub open_now: bool,
    /// The notification afterwards, if the result isn't obvious (an app window opening is).
    pub done: Option<String>,
    /// Instead of doing anything: say this, and offer to open the link.
    pub cannot: Option<(String, Option<String>)>,
}

fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| s.to_string()).collect()
}

fn with_path(parts: &[&str], path: &Path) -> Vec<String> {
    let mut v = argv(parts);
    v.push(path.to_string_lossy().into_owned());
    v
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

fn stem(path: &Path) -> String {
    let name = file_name(path);
    let name = name.split(['_', '-']).next().unwrap_or(&name);
    name.split('.').next().unwrap_or(name).to_string()
}

const FLATHUB_REPO: &str = "https://dl.flathub.org/repo/flathub.flatpakrepo";

fn pacman_install(package: &str) -> Step {
    Step::Admin(argv(&["pacman", "-S", "--needed", "--noconfirm", package]))
}

/// The `Name=` of a .flatpakref (the app id), to open the app after installing.
pub fn flatpakref_app_id(contents: &str) -> Option<String> {
    contents.lines().find_map(|l| l.strip_prefix("Name=")).map(|s| s.trim().to_string()).filter(|id| crate::classify::is_app_id(id))
}

pub fn plan(target: &Target, have: Available, flatpakref_id: Option<&str>) -> Plan {
    let empty = Plan { question: None, activity: String::new(), steps: vec![], open: None, open_now: true, done: None, cannot: None };
    let need_flatpak = |steps: &mut Vec<Step>| {
        if !have.flatpak {
            steps.push(pacman_install("flatpak"));
        }
        steps.push(Step::Run(argv(&["flatpak", "remote-add", "--user", "--if-not-exists", "flathub", FLATHUB_REPO])));
    };
    let flatpak_note = if have.flatpak { "" } else { " Flatpak support is installed first (you’ll be asked for your password)." };
    match target {
        Target::FlathubApp(id) => {
            let mut steps = vec![];
            need_flatpak(&mut steps);
            steps.push(Step::Run(argv(&["flatpak", "install", "--user", "-y", "--noninteractive", "flathub", id])));
            Plan {
                question: Some(Question {
                    title: format!("Install {id}?"),
                    body: format!("From Flathub, in its own sandbox.{flatpak_note}"),
                    actions: vec![("install".into(), "Install".into()), ("cancel".into(), "Cancel".into())],
                }),
                activity: format!("Installing {id}"),
                steps,
                open: Some(argv(&["flatpak", "run", id])),
                open_now: false,
                done: Some(format!("{id} is installed")),
                ..empty
            }
        }
        Target::FlatpakRef(path) => {
            let mut steps = vec![];
            need_flatpak(&mut steps);
            steps.push(Step::Run(with_path(&["flatpak", "install", "--user", "-y", "--noninteractive", "--from"], path)));
            let name = flatpakref_id.map(str::to_string).unwrap_or_else(|| stem(path));
            Plan {
                question: Some(Question {
                    title: format!("Install {name}?"),
                    body: format!("As a Flatpak, in its own sandbox.{flatpak_note}"),
                    actions: vec![("install".into(), "Install".into()), ("cancel".into(), "Cancel".into())],
                }),
                activity: format!("Installing {name}"),
                steps,
                open: flatpakref_id.map(|id| argv(&["flatpak", "run", id])),
                open_now: false,
                done: Some(format!("{name} is installed")),
                ..empty
            }
        }
        Target::FlatpakRepo(path) => {
            let mut steps = vec![];
            if !have.flatpak {
                steps.push(pacman_install("flatpak"));
            }
            let name = stem(path).to_lowercase();
            steps.push(Step::Run(vec![
                "flatpak".into(),
                "remote-add".into(),
                "--user".into(),
                "--if-not-exists".into(),
                "--from".into(),
                name.clone(),
                path.to_string_lossy().into_owned(),
            ]));
            Plan {
                question: Some(Question {
                    title: format!("Add the “{name}” app source?"),
                    body: "Apps from this source can then be installed.".into(),
                    actions: vec![("install".into(), "Add".into()), ("cancel".into(), "Cancel".into())],
                }),
                activity: format!("Adding {name}"),
                steps,
                done: Some(format!("Added the “{name}” app source")),
                ..empty
            }
        }
        Target::FlatpakBundle(path) => {
            let mut steps = vec![];
            if !have.flatpak {
                steps.push(pacman_install("flatpak"));
            }
            steps.push(Step::Run(with_path(&["flatpak", "install", "--user", "-y", "--noninteractive", "--bundle"], path)));
            Plan {
                question: Some(Question {
                    title: format!("Install {}?", file_name(path)),
                    body: format!("A Flatpak bundle, installed in its own sandbox.{flatpak_note}"),
                    actions: vec![("install".into(), "Install".into()), ("cancel".into(), "Cancel".into())],
                }),
                activity: format!("Installing {}", file_name(path)),
                steps,
                done: Some(format!("{} is installed", file_name(path))),
                ..empty
            }
        }
        Target::Windows { path, installer } => {
            let run = if file_name(path).to_lowercase().ends_with(".msi") {
                with_path(&["wine", "msiexec", "/i"], path)
            } else {
                with_path(&["wine", "start", "/unix"], path)
            };
            let question = (!have.wine).then(|| Question {
                title: format!("Open {} with Windows support?", file_name(path)),
                body: "Windows programs run with Wine, which is installed first (you’ll be asked for your password).".into(),
                actions: vec![("install".into(), "Install and Open".into()), ("cancel".into(), "Cancel".into())],
            });
            Plan {
                question,
                activity: if have.wine { String::new() } else { "Installing Windows support".into() },
                steps: if have.wine { vec![] } else { vec![pacman_install("wine")] },
                open: Some(run),
                // Installers finish on their own; their apps then show up in Launchpad.
                done: installer.then(|| format!("{} is running. Apps it installs appear in Launchpad.", file_name(path))),
                ..empty
            }
        }
        Target::AppImage(path) => Plan {
            question: Some(Question {
                title: format!("Add {} to your apps?", stem(path)),
                body: "It moves to the Applications folder in your home and shows up in Launchpad.".into(),
                actions: vec![("install".into(), "Add to Apps".into()), ("once".into(), "Just Open".into())],
            }),
            activity: String::new(),
            steps: vec![Step::AddAppImage(path.clone())],
            open: None,
            done: Some(format!("{} is in your apps", stem(path))),
            ..empty
        },
        Target::ArchPackage(path) => Plan {
            question: Some(Question {
                title: format!("Install {}?", file_name(path)),
                body: "A system package. Only install packages you trust; you’ll be asked for your password.".into(),
                actions: vec![("install".into(), "Install".into()), ("cancel".into(), "Cancel".into())],
            }),
            activity: format!("Installing {}", stem(path)),
            steps: vec![Step::Admin(with_path(&["pacman", "-U", "--noconfirm"], path))],
            done: Some(format!("{} is installed", stem(path))),
            ..empty
        },
        Target::ForeignPackage { path, kind } => Plan {
            cannot: Some((
                format!("{} is a {kind} package, which HelixOS can’t install directly. Most apps are on Flathub instead.", file_name(path)),
                Some(format!("https://flathub.org/apps/search?q={}", stem(path))),
            )),
            ..empty
        },
        Target::Android(path) => {
            if have.waydroid {
                Plan {
                    question: Some(Question {
                        title: format!("Install {}?", file_name(path)),
                        body: "An Android app, installed in Waydroid.".into(),
                        actions: vec![("install".into(), "Install".into()), ("cancel".into(), "Cancel".into())],
                    }),
                    activity: format!("Installing {}", stem(path)),
                    steps: vec![Step::Run(with_path(&["waydroid", "app", "install"], path))],
                    done: Some(format!("{} is installed. Find it in Launchpad.", stem(path))),
                    ..empty
                }
            } else {
                Plan {
                    cannot: Some((
                        "Android apps need Waydroid. Install it from the App Store, then open this file again.".into(),
                        Some("https://docs.waydro.id/usage/install-on-desktops".into()),
                    )),
                    ..empty
                }
            }
        }
        Target::Other(what) => Plan { open: Some(vec!["xdg-open".into(), what.clone()]), ..empty },
    }
}

/// The steps for "Just Open" on an AppImage.
pub fn appimage_once(path: &Path) -> (Vec<Step>, Vec<String>) {
    (vec![Step::MakeExecutable(path.to_path_buf())], vec![path.to_string_lossy().into_owned()])
}

/// A desktop entry for an AppImage in ~/Applications.
pub fn appimage_desktop_entry(name: &str, exec: &Path, icon: Option<&Path>) -> String {
    let quoted = exec.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
    format!(
        "[Desktop Entry]\nType=Application\nName={name}\nExec=\"{quoted}\" %U\nIcon={}\nTerminal=false\nCategories=Utility;\nX-HelixOS-AppImage=true\n",
        icon.map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| "application-x-executable".into())
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flathub_installs_flatpak_first_when_missing() {
        let target = Target::FlathubApp("com.spotify.Client".into());
        let p = plan(&target, Available::default(), None);
        assert_eq!(p.steps[0], Step::Admin(argv(&["pacman", "-S", "--needed", "--noconfirm", "flatpak"])));
        assert!(matches!(&p.steps[1], Step::Run(a) if a[1] == "remote-add"));
        assert_eq!(
            p.steps[2],
            Step::Run(argv(&["flatpak", "install", "--user", "-y", "--noninteractive", "flathub", "com.spotify.Client"]))
        );
        assert_eq!(p.open, Some(argv(&["flatpak", "run", "com.spotify.Client"])));
        assert!(p.question.unwrap().body.contains("password"));
        let with = plan(&target, Available { flatpak: true, ..Default::default() }, None);
        assert_eq!(with.steps.len(), 2);
        assert!(!with.question.unwrap().body.contains("password"));
    }

    #[test]
    fn windows_programs_run_with_wine() {
        let exe = Target::Windows { path: "/d/game.exe".into(), installer: false };
        let p = plan(&exe, Available { wine: true, ..Default::default() }, None);
        assert!(p.question.is_none() && p.steps.is_empty());
        assert_eq!(p.open, Some(argv(&["wine", "start", "/unix", "/d/game.exe"])));
        let msi = Target::Windows { path: "/d/x.msi".into(), installer: true };
        let p = plan(&msi, Available::default(), None);
        assert_eq!(p.steps, vec![pacman_install("wine")]);
        assert_eq!(p.open, Some(argv(&["wine", "msiexec", "/i", "/d/x.msi"])));
        assert!(p.question.is_some() && p.done.is_some());
    }

    #[test]
    fn flatpakref_uses_the_app_id() {
        assert_eq!(flatpakref_app_id("[Flatpak Ref]\nName=org.gimp.GIMP\nBranch=stable\n"), Some("org.gimp.GIMP".into()));
        assert_eq!(flatpakref_app_id("Name=bad id"), None);
        let p = plan(
            &Target::FlatpakRef("/d/gimp.flatpakref".into()),
            Available { flatpak: true, ..Default::default() },
            Some("org.gimp.GIMP"),
        );
        assert_eq!(p.open, Some(argv(&["flatpak", "run", "org.gimp.GIMP"])));
        assert!(p.question.unwrap().title.contains("org.gimp.GIMP"));
    }

    #[test]
    fn packages_and_android() {
        let deb = plan(&Target::ForeignPackage { path: "/d/code_1.9_amd64.deb".into(), kind: "Debian/Ubuntu" }, Available::default(), None);
        let (message, link) = deb.cannot.unwrap();
        assert!(message.contains("Flathub"));
        assert_eq!(link.unwrap(), "https://flathub.org/apps/search?q=code");
        let apk = plan(&Target::Android("/d/app.apk".into()), Available::default(), None);
        assert!(apk.cannot.is_some());
        let apk = plan(&Target::Android("/d/app.apk".into()), Available { waydroid: true, ..Default::default() }, None);
        assert!(matches!(&apk.steps[0], Step::Run(a) if a[0] == "waydroid"));
        let arch = plan(&Target::ArchPackage("/d/yay-12.pkg.tar.zst".into()), Available::default(), None);
        assert_eq!(arch.steps, vec![Step::Admin(argv(&["pacman", "-U", "--noconfirm", "/d/yay-12.pkg.tar.zst"]))]);
    }

    #[test]
    fn appimage_entry() {
        let entry = appimage_desktop_entry("Tool", Path::new("/home/a/Applications/Tool \"x\".AppImage"), None);
        assert!(entry.contains("Exec=\"/home/a/Applications/Tool \\\"x\\\".AppImage\" %U"));
        assert!(entry.contains("Icon=application-x-executable"));
    }
}
