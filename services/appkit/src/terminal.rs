//! Opening a terminal to run something that needs the user (sudo password, prompts), such as
//! system updates from Settings → Software Update.

use helixos_syslib::CommandRunner;

use crate::{AppError, Result};

/// Terminals tried in order, with the arguments that make each run a command.
const TERMINALS: [(&str, &[&str]); 6] = [
    ("helixos-terminal", &["--"]),
    ("xdg-terminal-exec", &[]),
    ("kitty", &[]),
    ("foot", &[]),
    ("alacritty", &["-e"]),
    ("wezterm", &["start", "--"]),
];

/// argv for running `script` with `sh -c` in `terminal`.
pub fn terminal_argv(terminal: &str, script: &str) -> Option<Vec<String>> {
    let (_, prefix) = TERMINALS.iter().find(|(name, _)| *name == terminal)?;
    let mut argv: Vec<String> = prefix.iter().map(|s| s.to_string()).collect();
    argv.extend(["sh".into(), "-c".into(), script.into()]);
    Some(argv)
}

/// The update command: pacman, then Flatpak apps if Flatpak is installed. The window stays
/// open at the end so the result can be read.
pub const UPDATE_SCRIPT: &str = "echo 'Updating HelixOS…'; sudo pacman -Syu; \
    if command -v flatpak >/dev/null; then flatpak update; fi; \
    echo; printf 'Done. Press Enter to close.'; read -r _";

/// Open the first installed terminal running `script`.
pub async fn run_in_terminal(runner: &dyn CommandRunner, script: &str) -> Result<()> {
    for (terminal, _) in TERMINALS {
        let argv = terminal_argv(terminal, script).expect("listed terminal");
        match runner.spawn_detached(terminal, &argv).await {
            Ok(()) => return Ok(()),
            Err(helixos_syslib::SysError::NotInstalled { .. }) => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::Invalid("No terminal app is installed.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_argv_per_terminal() {
        assert_eq!(terminal_argv("kitty", "ls").unwrap(), ["sh", "-c", "ls"]);
        assert_eq!(terminal_argv("alacritty", "ls").unwrap(), ["-e", "sh", "-c", "ls"]);
        assert!(terminal_argv("xterm", "ls").is_none());
    }

    #[tokio::test]
    async fn uses_the_first_terminal_that_starts() {
        let runner = helixos_syslib::MockRunner::new();
        run_in_terminal(&runner, "true").await.unwrap();
        assert_eq!(runner.calls()[0][0], "helixos-terminal");
    }
}
