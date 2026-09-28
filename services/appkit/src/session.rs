//! What kind of session Settings is running in: a real install, the preview taking over a
//! virtual terminal (real input devices, Super key), or the preview nested in a window on the
//! host desktop (forwarded input, no touchpad device, Alt instead of Super).

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
    Installed,
    /// scripts/live.sh from a text console: real input devices, the real Super key.
    LiveFullscreen,
    /// scripts/live.sh inside a window on the host desktop: the host compositor owns the
    /// touchpad and keyboard, so per-device settings (and Super) do not reach this session.
    LiveNested,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct SessionInfo {
    pub kind: SessionKind,
    /// The key that plays Super's role here (nested: Alt, since the host desktop keeps Super).
    pub mod_key: &'static str,
}

/// From the two environment variables the session sets: `HELIXOS_LIVE` (scripts/live.sh's
/// container), and `HELIXOS_NESTED` (set by `session()` *before* Hyprland starts, from whether
/// a host `WAYLAND_DISPLAY` was already present — checking that variable any later would see
/// Hyprland's own display for its clients instead, which is set either way).
pub fn classify(live: bool, nested: bool) -> SessionInfo {
    match (live, nested) {
        (true, true) => SessionInfo { kind: SessionKind::LiveNested, mod_key: "Alt" },
        (true, false) => SessionInfo { kind: SessionKind::LiveFullscreen, mod_key: "Super" },
        (false, _) => SessionInfo { kind: SessionKind::Installed, mod_key: "Super" },
    }
}

pub fn current() -> SessionInfo {
    let live = std::env::var_os("HELIXOS_LIVE").is_some();
    let nested = std::env::var("HELIXOS_NESTED").is_ok_and(|v| v == "1");
    classify(live, nested)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_by_the_two_env_vars() {
        assert_eq!(classify(false, false).kind, SessionKind::Installed);
        assert_eq!(classify(false, true).kind, SessionKind::Installed);
        assert_eq!(classify(true, false), SessionInfo { kind: SessionKind::LiveFullscreen, mod_key: "Super" });
        assert_eq!(classify(true, true), SessionInfo { kind: SessionKind::LiveNested, mod_key: "Alt" });
    }
}
