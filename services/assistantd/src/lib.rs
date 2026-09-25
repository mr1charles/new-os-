//! NewOS assistant daemon.
//!
//! The shell and apps talk to it over a unix socket (`$XDG_RUNTIME_DIR/newos/assistant.sock`)
//! with a small HTTP API; see [`api`]. Each chat request runs the agent loop in [`agent`],
//! which picks a model provider through [`router`] (Claude in the cloud when online and a key
//! is configured, Ollama on the device otherwise), streams the reply, and executes tools from
//! [`tools`].

pub mod agent;
pub mod api;
pub mod config;
pub mod conversation;
pub mod events;
pub mod memory;
pub mod prompt;
pub mod providers;
pub mod router;
pub mod secrets;
pub mod state;
pub mod tools;

pub use config::Config;
pub use state::AppState;
