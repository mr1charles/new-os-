//! Choosing between the cloud model and the on-device model.

use serde::{Deserialize, Serialize};

use crate::providers::ProviderKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Cloud when a key is configured and the network is up, otherwise local.
    #[default]
    Auto,
    Cloud,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Availability {
    pub cloud_configured: bool,
    pub online: bool,
    pub local_available: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct NoProvider(pub String);

pub fn choose(mode: Mode, available: Availability) -> Result<ProviderKind, NoProvider> {
    let cloud_ready = available.cloud_configured && available.online;
    match mode {
        Mode::Auto if cloud_ready => Ok(ProviderKind::Cloud),
        Mode::Auto if available.local_available => Ok(ProviderKind::Local),
        Mode::Auto if available.cloud_configured => Err(NoProvider(
            "You're offline and no on-device model is installed. Connect to the internet, or install one with: ollama pull <model>".into(),
        )),
        Mode::Auto => Err(NoProvider(
            "No model is set up. Add an Anthropic API key in Settings → Assistant, or install an on-device model with Ollama.".into(),
        )),
        Mode::Cloud if cloud_ready => Ok(ProviderKind::Cloud),
        Mode::Cloud if !available.cloud_configured => {
            Err(NoProvider("Cloud mode is on but no Anthropic API key is configured (Settings → Assistant).".into()))
        }
        Mode::Cloud => Err(NoProvider("Cloud mode is on but the computer is offline.".into())),
        Mode::Local if available.local_available => Ok(ProviderKind::Local),
        Mode::Local => Err(NoProvider(
            "On-device mode is on but the local model isn't available. Start Ollama and pull the model set in Settings → Assistant.".into(),
        )),
    }
}

/// After a cloud request fails before producing any output, should the turn be retried on
/// the local model?
pub fn should_fall_back(mode: Mode, available: Availability) -> bool {
    mode == Mode::Auto && available.local_available
}

#[cfg(test)]
mod tests {
    use super::*;

    fn avail(cloud_configured: bool, online: bool, local_available: bool) -> Availability {
        Availability { cloud_configured, online, local_available }
    }

    #[test]
    fn auto_prefers_cloud_then_local() {
        assert_eq!(choose(Mode::Auto, avail(true, true, true)), Ok(ProviderKind::Cloud));
        assert_eq!(choose(Mode::Auto, avail(true, true, false)), Ok(ProviderKind::Cloud));
        assert_eq!(choose(Mode::Auto, avail(true, false, true)), Ok(ProviderKind::Local));
        assert_eq!(choose(Mode::Auto, avail(false, true, true)), Ok(ProviderKind::Local));
        assert!(choose(Mode::Auto, avail(true, false, false)).unwrap_err().0.contains("offline"));
        assert!(choose(Mode::Auto, avail(false, true, false)).unwrap_err().0.contains("API key"));
    }

    #[test]
    fn forced_modes_never_switch() {
        assert_eq!(choose(Mode::Cloud, avail(true, true, true)), Ok(ProviderKind::Cloud));
        assert!(choose(Mode::Cloud, avail(true, false, true)).is_err());
        assert!(choose(Mode::Cloud, avail(false, true, true)).is_err());
        assert_eq!(choose(Mode::Local, avail(true, true, true)), Ok(ProviderKind::Local));
        assert!(choose(Mode::Local, avail(true, true, false)).is_err());
    }

    #[test]
    fn falls_back_only_in_auto_with_a_local_model() {
        assert!(should_fall_back(Mode::Auto, avail(true, true, true)));
        assert!(!should_fall_back(Mode::Auto, avail(true, true, false)));
        assert!(!should_fall_back(Mode::Cloud, avail(true, true, true)));
    }
}
