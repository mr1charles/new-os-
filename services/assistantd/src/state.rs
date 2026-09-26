//! Shared daemon state.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use helixos_syslib::{CommandRunner, SystemRunner};
use tokio::sync::{broadcast, oneshot};

use crate::config::{Config, Paths};
use crate::events::SystemEvent;
use crate::memory::Memory;
use crate::providers::claude::{ClaudeProvider, ClaudeSettings};
use crate::providers::ollama::{OllamaProvider, OllamaSettings};
use crate::providers::{BoxFuture, Provider, ProviderKind};
use crate::router::Availability;
use crate::secrets::{find_api_key, KeySource};
use crate::tools::{self, Tool, ToolContext};

/// Reports which providers can be used right now.
pub trait AvailabilityProbe: Send + Sync {
    fn probe(&self) -> BoxFuture<'_, Availability>;
}

/// Checks the network by reaching the Anthropic API host, and Ollama by listing its models.
/// Results are cached for a short time so every request doesn't pay for the checks.
pub struct LiveProbe {
    http: reqwest::Client,
    cloud_url: String,
    cloud_configured: bool,
    ollama: Arc<OllamaProvider>,
    cache: Mutex<Option<(Instant, Availability)>>,
}

const PROBE_TTL: Duration = Duration::from_secs(20);

impl AvailabilityProbe for LiveProbe {
    fn probe(&self) -> BoxFuture<'_, Availability> {
        Box::pin(async move {
            if let Some((at, cached)) = *self.cache.lock().unwrap() {
                if at.elapsed() < PROBE_TTL {
                    return cached;
                }
            }
            let online = async {
                // Any HTTP answer (even 404) proves the network path works.
                self.http.head(&self.cloud_url).timeout(Duration::from_secs(3)).send().await.is_ok()
            };
            let (online, local_available) = tokio::join!(online, self.ollama.available());
            let result = Availability { cloud_configured: self.cloud_configured, online, local_available };
            *self.cache.lock().unwrap() = Some((Instant::now(), result));
            result
        })
    }
}

/// Fixed availability, for tests and `--mode` overrides.
pub struct StaticProbe(pub Availability);

impl AvailabilityProbe for StaticProbe {
    fn probe(&self) -> BoxFuture<'_, Availability> {
        let value = self.0;
        Box::pin(async move { value })
    }
}

pub struct AppState {
    pub config: Config,
    pub cloud: Option<Arc<dyn Provider>>,
    pub local: Arc<dyn Provider>,
    /// Concrete handle for embeddings (only Ollama provides them).
    pub ollama: Option<Arc<OllamaProvider>>,
    pub probe: Arc<dyn AvailabilityProbe>,
    pub tools: Vec<Tool>,
    pub tool_ctx: ToolContext,
    pub memory: Arc<Memory>,
    pub events: broadcast::Sender<SystemEvent>,
    pub pending: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    pub key_source: Option<KeySource>,
}

/// Everything needed to assemble an [`AppState`]; tests swap in mocks.
pub struct StateParts {
    pub config: Config,
    pub cloud: Option<Arc<dyn Provider>>,
    pub local: Arc<dyn Provider>,
    pub ollama: Option<Arc<OllamaProvider>>,
    pub probe: Arc<dyn AvailabilityProbe>,
    pub runner: Arc<dyn CommandRunner>,
    pub memory: Arc<Memory>,
    pub home: PathBuf,
    pub app_dirs: Vec<PathBuf>,
    pub power_supply_dir: PathBuf,
    pub key_source: Option<KeySource>,
}

impl AppState {
    pub fn assemble(parts: StateParts) -> Arc<Self> {
        let (events, _) = broadcast::channel(64);
        let tool_ctx = ToolContext {
            runner: parts.runner,
            notes_dir: parts.config.notes_dir(&parts.home),
            home: parts.home,
            memory: parts.memory.clone(),
            events: events.clone(),
            timers: Mutex::new(Vec::new()),
            app_dirs: parts.app_dirs,
            power_supply_dir: parts.power_supply_dir,
        };
        Arc::new(Self {
            tools: tools::all(parts.config.tools.allow_shell),
            config: parts.config,
            cloud: parts.cloud,
            local: parts.local,
            ollama: parts.ollama,
            probe: parts.probe,
            tool_ctx,
            memory: parts.memory,
            events,
            pending: Mutex::new(HashMap::new()),
            key_source: parts.key_source,
        })
    }

    /// Real providers and system access, from the config and environment.
    pub fn from_config(config: Config, paths: &Paths) -> anyhow::Result<Arc<Self>> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .user_agent(concat!("helixos-assistantd/", env!("CARGO_PKG_VERSION")))
            .build()?;
        let key = find_api_key(&config.cloud);
        let key_source = key.as_ref().map(|(_, source)| *source);
        let cloud: Option<Arc<dyn Provider>> = key.map(|(api_key, _)| {
            Arc::new(ClaudeProvider::new(
                http.clone(),
                ClaudeSettings {
                    base_url: config.cloud.base_url.clone(),
                    api_key,
                    model: config.cloud.model.clone(),
                    effort: config.cloud.effort.clone(),
                    thinking: config.cloud.thinking,
                    fallbacks: config.cloud.fallbacks,
                },
            )) as Arc<dyn Provider>
        });
        let ollama = Arc::new(OllamaProvider::new(
            http.clone(),
            OllamaSettings {
                base_url: config.local.url.clone(),
                model: config.local.model.clone(),
                embed_model: config.local.embed_model.clone(),
                num_ctx: config.local.num_ctx,
            },
        ));
        let probe = Arc::new(LiveProbe {
            http,
            cloud_url: config.cloud.base_url.clone(),
            cloud_configured: cloud.is_some(),
            ollama: ollama.clone(),
            cache: Mutex::new(None),
        });
        let memory =
            Arc::new(if config.privacy.store_history { Memory::open(&paths.data_dir.join("assistant.db"))? } else { Memory::in_memory()? });
        Ok(Self::assemble(StateParts {
            config,
            cloud,
            local: ollama.clone(),
            ollama: Some(ollama),
            probe,
            runner: Arc::new(SystemRunner::default()),
            memory,
            home: paths.home.clone(),
            app_dirs: helixos_syslib::desktop::application_dirs(),
            power_supply_dir: PathBuf::from("/sys/class/power_supply"),
            key_source,
        }))
    }

    pub fn provider(&self, kind: ProviderKind) -> Option<Arc<dyn Provider>> {
        match kind {
            ProviderKind::Cloud => self.cloud.clone(),
            ProviderKind::Local => Some(self.local.clone()),
        }
    }
}
