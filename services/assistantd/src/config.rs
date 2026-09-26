//! ~/.config/helixos/assistant.toml. Every field has a default, so an empty or missing file works.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::router::Mode;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// "auto" uses the cloud model when online and configured, else the local model.
    pub mode: Mode,
    /// What the assistant calls itself.
    pub name: String,
    pub cloud: CloudConfig,
    pub local: LocalConfig,
    pub privacy: PrivacyConfig,
    pub tools: ToolsConfig,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CloudConfig {
    pub base_url: String,
    pub model: String,
    /// low | medium | high | xhigh | max. Medium keeps replies quick for a desktop assistant.
    pub effort: String,
    /// Upper bound on thinking plus reply for chat turns (streamed, so large is safe).
    pub max_tokens: u32,
    /// Adaptive thinking. Turn off only for models that do not support it.
    pub thinking: bool,
    /// Server-side refusal fallbacks (`fallbacks: "default"`), re-running a declined request on
    /// Anthropic's recommended fallback model instead of returning the refusal.
    pub fallbacks: bool,
    /// Environment variable checked first for the API key.
    pub api_key_env: String,
    /// Optional file holding the key (mode 0600). The Secret Service keyring is checked too.
    pub api_key_file: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LocalConfig {
    pub url: String,
    pub model: String,
    pub embed_model: String,
    /// Context window requested from Ollama.
    pub num_ctx: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PrivacyConfig {
    /// Send the focused window's app and title with each request.
    pub share_window_title: bool,
    /// Keep conversations on disk (~/.local/share/helixos/assistant.db). Off keeps them in memory.
    pub store_history: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ToolsConfig {
    /// Allow the run_shell tool. Every command still needs the user's approval in the island.
    pub allow_shell: bool,
    /// Where notes live (shared with the Notes app). Empty means ~/Notes.
    pub notes_dir: Option<PathBuf>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            mode: Mode::Auto,
            name: "Assistant".into(),
            cloud: CloudConfig::default(),
            local: LocalConfig::default(),
            privacy: PrivacyConfig::default(),
            tools: ToolsConfig::default(),
        }
    }
}

impl Default for CloudConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.anthropic.com".into(),
            model: "claude-opus-5".into(),
            effort: "medium".into(),
            max_tokens: 64_000,
            thinking: true,
            fallbacks: true,
            api_key_env: "ANTHROPIC_API_KEY".into(),
            api_key_file: None,
        }
    }
}

impl Default for LocalConfig {
    fn default() -> Self {
        Self { url: "http://127.0.0.1:11434".into(), model: "qwen2.5:3b".into(), embed_model: "nomic-embed-text".into(), num_ctx: 8192 }
    }
}

impl Default for PrivacyConfig {
    fn default() -> Self {
        Self { share_window_title: true, store_history: true }
    }
}

impl Default for ToolsConfig {
    fn default() -> Self {
        Self { allow_shell: true, notes_dir: None }
    }
}

pub const EFFORT_LEVELS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

impl Config {
    pub fn parse(text: &str) -> anyhow::Result<Self> {
        let config: Config = toml::from_str(text)?;
        config.validate()?;
        Ok(config)
    }

    pub fn load(path: &Path) -> anyhow::Result<Self> {
        match std::fs::read_to_string(path) {
            Ok(text) => Self::parse(&text).map_err(|e| anyhow::anyhow!("{}: {e}", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn validate(&self) -> anyhow::Result<()> {
        if !EFFORT_LEVELS.contains(&self.cloud.effort.as_str()) {
            anyhow::bail!("cloud.effort must be one of {:?}", EFFORT_LEVELS);
        }
        if self.cloud.max_tokens < 1024 {
            anyhow::bail!("cloud.max_tokens must be at least 1024");
        }
        if self.name.trim().is_empty() {
            anyhow::bail!("name must not be empty");
        }
        Ok(())
    }

    pub fn notes_dir(&self, home: &Path) -> PathBuf {
        self.tools.notes_dir.clone().unwrap_or_else(|| home.join("Notes"))
    }
}

/// Standard locations, following the XDG base directory spec.
#[derive(Debug, Clone)]
pub struct Paths {
    pub home: PathBuf,
    pub config_file: PathBuf,
    pub data_dir: PathBuf,
    pub socket: PathBuf,
}

impl Paths {
    pub fn from_env() -> Self {
        let home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()));
        let config_home = std::env::var("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".config"));
        let data_home = std::env::var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".local/share"));
        let runtime = std::env::var("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
        Self {
            config_file: config_home.join("helixos/assistant.toml"),
            data_dir: data_home.join("helixos"),
            socket: runtime.join("helixos/assistant.sock"),
            home,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_file_gives_defaults() {
        let config = Config::parse("").unwrap();
        assert_eq!(config, Config::default());
        assert_eq!(config.cloud.model, "claude-opus-5");
        assert_eq!(config.mode, Mode::Auto);
    }

    #[test]
    fn partial_files_merge_with_defaults() {
        let config =
            Config::parse("mode = \"local\"\nname = \"Nova\"\n[cloud]\neffort = \"low\"\n[local]\nmodel = \"llama3.2:3b\"\n").unwrap();
        assert_eq!(config.mode, Mode::Local);
        assert_eq!(config.name, "Nova");
        assert_eq!(config.cloud.effort, "low");
        assert_eq!(config.cloud.max_tokens, 64_000);
        assert_eq!(config.local.model, "llama3.2:3b");
    }

    #[test]
    fn rejects_typos_and_bad_values() {
        assert!(Config::parse("mdoe = \"auto\"").is_err());
        assert!(Config::parse("[cloud]\neffort = \"extreme\"").is_err());
        assert!(Config::parse("mode = \"sometimes\"").is_err());
    }

    #[test]
    fn example_file_matches_the_defaults() {
        let example = Config::parse(include_str!("../assistant.example.toml")).unwrap();
        assert_eq!(example, Config::default());
    }

    #[test]
    fn missing_file_is_default() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Config::load(&dir.path().join("none.toml")).unwrap(), Config::default());
    }
}
