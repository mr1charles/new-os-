//! Pending system updates for Settings → Software Update: pacman packages through
//! `checkupdates` (pacman-contrib, no root needed) and Flatpak apps.

use crate::runner::CommandRunner;
use crate::Result;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PackageUpdate {
    pub name: String,
    pub from: String,
    pub to: String,
    /// "system" (pacman) or "flatpak".
    pub source: String,
}

/// Parse `checkupdates`: "bash 5.3.15-2 -> 5.3.20-2".
pub fn parse_checkupdates(output: &str) -> Vec<PackageUpdate> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let (name, from, arrow, to) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
            (arrow == "->").then(|| PackageUpdate { name: name.into(), from: from.into(), to: to.into(), source: "system".into() })
        })
        .collect()
}

/// Parse `flatpak remote-ls --updates --columns=application,version`: tab-separated.
pub fn parse_flatpak_updates(output: &str) -> Vec<PackageUpdate> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let name = parts.next()?.trim();
            (!name.is_empty() && name.contains('.')).then(|| PackageUpdate {
                name: name.into(),
                from: String::new(),
                to: parts.next().unwrap_or("").trim().into(),
                source: "flatpak".into(),
            })
        })
        .collect()
}

/// Both lists. `checkupdates` exits 2 when there is nothing to update, and either tool may be
/// missing; both cases mean "no updates from that source".
pub async fn pending_updates(runner: &dyn CommandRunner) -> Result<Vec<PackageUpdate>> {
    let mut updates = Vec::new();
    if let Ok(out) = runner.run("checkupdates", &[]).await {
        if out.status == 0 {
            updates.extend(parse_checkupdates(&out.stdout));
        } else if out.status != 2 {
            return Err(crate::SysError::Failed { program: "checkupdates".into(), message: out.stderr.trim().to_string() });
        }
    }
    let args: Vec<String> = ["remote-ls", "--updates", "--columns=application,version"].iter().map(|s| s.to_string()).collect();
    if let Ok(out) = runner.run("flatpak", &args).await {
        if out.success() {
            updates.extend(parse_flatpak_updates(&out.stdout));
        }
    }
    Ok(updates)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pacman_updates() {
        let updates = parse_checkupdates("aom 3.15.0-1.1 -> 3.15.1-1.1\nbash 5.3.15-2 -> 5.3.20-2\n\n");
        assert_eq!(updates.len(), 2);
        assert_eq!((updates[1].name.as_str(), updates[1].to.as_str()), ("bash", "5.3.20-2"));
    }

    #[test]
    fn parses_flatpak_updates() {
        let updates = parse_flatpak_updates("org.mozilla.firefox\t131.0\nApplication ID\tVersion\n");
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].source, "flatpak");
    }
}
