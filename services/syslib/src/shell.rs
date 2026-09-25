//! Talking to the NewOS shell (`ags request -i newos ...`) and opening things.

use crate::runner::{run_checked, CommandRunner};
use crate::{Result, SysError};

/// Send a command to the shell, e.g. `["theme", "dark"]`. See shell/lib/requests.ts.
pub async fn shell_request(runner: &dyn CommandRunner, args: &[&str]) -> Result<String> {
    let mut argv = vec!["request", "-i", "newos"];
    argv.extend_from_slice(args);
    Ok(run_checked(runner, "ags", &argv).await?.trim().to_string())
}

/// Launch an app by desktop id through gtk-launch (detached, survives the daemon).
pub async fn launch_app(runner: &dyn CommandRunner, desktop_id: &str) -> Result<()> {
    let id = desktop_id.trim_end_matches(".desktop");
    if id.is_empty() || id.contains('/') || id.starts_with('-') {
        return Err(SysError::Invalid(format!("not a desktop id: {desktop_id}")));
    }
    runner.spawn_detached("gtk-launch", &[id.to_string()]).await
}

/// Only web and mail links. Local files go through [`open_path`].
pub fn allowed_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")) && !url.chars().any(char::is_whitespace)
}

pub async fn open_url(runner: &dyn CommandRunner, url: &str) -> Result<()> {
    if !allowed_url(url) {
        return Err(SysError::Invalid(format!("only http(s) and mailto links can be opened: {url}")));
    }
    runner.spawn_detached("xdg-open", &[url.to_string()]).await
}

pub async fn open_path(runner: &dyn CommandRunner, path: &std::path::Path) -> Result<()> {
    if !path.exists() {
        return Err(SysError::Invalid(format!("{} does not exist", path.display())));
    }
    runner.spawn_detached("xdg-open", &[path.to_string_lossy().into_owned()]).await
}

/// Move to the freedesktop Trash (recoverable), never delete.
pub async fn trash(runner: &dyn CommandRunner, path: &std::path::Path) -> Result<()> {
    if !path.exists() {
        return Err(SysError::Invalid(format!("{} does not exist", path.display())));
    }
    run_checked(runner, "gio", &["trash", "--", &path.to_string_lossy()]).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MockRunner;

    #[test]
    fn allows_only_web_and_mail_urls() {
        assert!(allowed_url("https://example.com/a?b=c"));
        assert!(allowed_url("mailto:me@example.com"));
        assert!(!allowed_url("file:///etc/passwd"));
        assert!(!allowed_url("javascript:alert(1)"));
        assert!(!allowed_url("https://a.com/ b"));
    }

    #[tokio::test]
    async fn sends_shell_requests() {
        let runner = MockRunner::new();
        shell_request(&runner, &["theme", "dark"]).await.unwrap();
        assert_eq!(runner.calls()[0], ["ags", "request", "-i", "newos", "theme", "dark"]);
    }

    #[tokio::test]
    async fn rejects_suspicious_desktop_ids() {
        let runner = MockRunner::new();
        assert!(launch_app(&runner, "../evil").await.is_err());
        assert!(launch_app(&runner, "--help").await.is_err());
        launch_app(&runner, "firefox.desktop").await.unwrap();
        assert_eq!(runner.calls()[0], ["gtk-launch", "firefox"]);
    }
}
