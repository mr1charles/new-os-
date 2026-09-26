//! The signed-in account and its fingerprints, for Settings → Users & Spaces. Creating and
//! switching spaces is `spacesd`'s job (milestone 5).

use crate::runner::CommandRunner;
use crate::Result;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Account {
    pub username: String,
    /// The GECOS name, or the username when it is empty or a placeholder like ".".
    pub full_name: String,
    pub uid: u32,
    pub home: String,
    pub shell: String,
    /// Member of `wheel`, so it can use sudo.
    pub admin: bool,
}

/// Parse one `getent passwd` line: "a:x:1000:1000:Full Name,,,:/home/a:/bin/fish".
pub fn parse_passwd(line: &str, groups: &str) -> Option<Account> {
    let fields: Vec<&str> = line.trim().split(':').collect();
    let [username, _, uid, _, gecos, home, shell] = fields.as_slice() else { return None };
    let name = gecos.split(',').next().unwrap_or("").trim();
    let full_name = if name.chars().any(char::is_alphanumeric) { name.to_string() } else { username.to_string() };
    Some(Account {
        username: username.to_string(),
        full_name,
        uid: uid.parse().ok()?,
        home: home.to_string(),
        shell: shell.to_string(),
        admin: groups.split_whitespace().any(|g| g == "wheel"),
    })
}

pub async fn current_account(runner: &dyn CommandRunner) -> Result<Account> {
    let user = std::env::var("USER").unwrap_or_default();
    let passwd = crate::runner::run_checked(runner, "getent", &["passwd", &user]).await?;
    let groups = crate::runner::run_checked(runner, "id", &["-Gn"]).await.unwrap_or_default();
    parse_passwd(&passwd, &groups).ok_or(crate::SysError::Parse { program: "getent".into(), output: passwd })
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct Fingerprints {
    /// A reader fprintd can use is present.
    pub available: bool,
    /// "ELAN Match-on-Chip 2"
    pub device: String,
    /// fprintd finger names, e.g. "right-index-finger".
    pub enrolled: Vec<String>,
}

/// Parse `fprintd-list <user>`.
pub fn parse_fprintd_list(output: &str) -> Fingerprints {
    let mut prints = Fingerprints::default();
    for line in output.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Fingerprints for user ") {
            prints.available = true;
            if let Some((_, device)) = rest.split_once(" on ") {
                prints.device = device.rsplit_once(" (").map(|(d, _)| d).unwrap_or(device).trim().to_string();
            }
        } else if let Some(rest) = line.strip_prefix("- #") {
            if let Some((_, finger)) = rest.split_once(": ") {
                prints.enrolled.push(finger.trim().to_string());
            }
        } else if line.starts_with("User ") && line.contains("no fingers enrolled") {
            prints.available = true;
        }
    }
    prints
}

/// A machine without a reader (or without fprintd) reports `available: false`, not an error.
pub async fn fingerprints(runner: &dyn CommandRunner) -> Fingerprints {
    let user = std::env::var("USER").unwrap_or_default();
    let args = vec![user];
    match runner.run("fprintd-list", &args).await {
        Ok(output) => parse_fprintd_list(&format!("{}\n{}", output.stdout, output.stderr)),
        Err(_) => Fingerprints::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_accounts() {
        let account = parse_passwd("a:x:1000:1000:.:/home/a:/bin/fish\n", "a sys wheel audio").unwrap();
        assert_eq!((account.full_name.as_str(), account.uid, account.admin), ("a", 1000, true));
        let account = parse_passwd("sam:x:1001:1001:Sam Rivera,,,:/home/sam:/bin/bash", "sam users").unwrap();
        assert_eq!(account.full_name, "Sam Rivera");
        assert!(!account.admin);
        assert!(parse_passwd("broken", "").is_none());
    }

    #[test]
    fn parses_fprintd_output() {
        let out = "found 1 devices\nDevice at /net/reactivated/Fprint/Device/0\nUsing device /net/reactivated/Fprint/Device/0\nFingerprints for user a on ELAN Match-on-Chip 2 (press):\n - #0: right-middle-finger\n - #1: left-index-finger\n";
        let prints = parse_fprintd_list(out);
        assert!(prints.available);
        assert_eq!(prints.device, "ELAN Match-on-Chip 2");
        assert_eq!(prints.enrolled, ["right-middle-finger", "left-index-finger"]);
        assert_eq!(parse_fprintd_list("No devices available\n"), Fingerprints::default());
    }
}
