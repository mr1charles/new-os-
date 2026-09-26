//! Live activities and notifications for apps.
//!
//! Activities go to the shell's `org.helixos.Island1` (see shell/lib/island-service.ts): a
//! progress or status that sits in the Dynamic Island while it lasts. Notifications go to the
//! standard `org.freedesktop.Notifications`, which the shell shows in the island and the
//! Notification Center.
//!
//! One session-bus connection is kept for the app's lifetime: the shell scopes activity ids to
//! the caller's connection, and ends them all when the app quits.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::OnceCell;
use zbus::zvariant::Value;

use crate::{AppError, Result};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Activity {
    /// The app's window class, so clicking the island brings the app forward.
    pub app: String,
    pub icon: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    /// 0..1, or none for "working on it".
    #[serde(default)]
    pub progress: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Notification {
    pub app_name: String,
    pub icon: String,
    pub summary: String,
    #[serde(default)]
    pub body: String,
    /// Replace an earlier notification from this app (the id `notify` returned).
    #[serde(default)]
    pub replaces: u32,
    #[serde(default)]
    pub urgent: bool,
}

static SESSION: OnceCell<zbus::Connection> = OnceCell::const_new();

async fn session() -> Result<&'static zbus::Connection> {
    SESSION
        .get_or_try_init(|| async {
            match std::env::var("HELIXOS_ISLAND_BUS") {
                // Tests point this at a private bus.
                Ok(address) => zbus::connection::Builder::address(address.as_str())?.build().await,
                Err(_) => zbus::Connection::session().await,
            }
        })
        .await
        .map_err(|e| AppError::Invalid(format!("Can’t reach the session bus: {e}")))
}

fn shell_missing(error: zbus::Error) -> AppError {
    match error {
        zbus::Error::MethodError(name, message, _) => {
            let name = name.as_str();
            if name.ends_with("ServiceUnknown") || name.ends_with("NameHasNoOwner") {
                AppError::Invalid("The HelixOS shell isn’t running.".into())
            } else {
                AppError::Invalid(message.unwrap_or_else(|| name.to_string()))
            }
        }
        other => AppError::Invalid(other.to_string()),
    }
}

const SHELL: &str = "org.helixos.Shell1";
const ISLAND_PATH: &str = "/org/helixos/Island1";
const ISLAND: &str = "org.helixos.Island1";

/// Show an activity, or update the one with the same id.
pub async fn show(id: &str, activity: &Activity) -> Result<()> {
    let json = serde_json::to_string(activity)?;
    session().await?.call_method(Some(SHELL), ISLAND_PATH, Some(ISLAND), "Show", &(id, json.as_str())).await.map_err(shell_missing)?;
    Ok(())
}

pub async fn end(id: &str) -> Result<()> {
    session().await?.call_method(Some(SHELL), ISLAND_PATH, Some(ISLAND), "End", &(id,)).await.map_err(shell_missing)?;
    Ok(())
}

/// Post a notification; returns its id.
pub async fn notify(n: &Notification) -> Result<u32> {
    let mut hints: HashMap<&str, Value<'_>> = HashMap::new();
    hints.insert("urgency", Value::U8(if n.urgent { 2 } else { 1 }));
    let actions: Vec<&str> = vec!["default", "Open"];
    let reply = session()
        .await?
        .call_method(
            Some("org.freedesktop.Notifications"),
            "/org/freedesktop/Notifications",
            Some("org.freedesktop.Notifications"),
            "Notify",
            &(n.app_name.as_str(), n.replaces, n.icon.as_str(), n.summary.as_str(), n.body.as_str(), actions, hints, -1i32),
        )
        .await
        .map_err(|e| match e {
            zbus::Error::MethodError(name, _, _) if name.as_str().ends_with("ServiceUnknown") => {
                AppError::Invalid("No notification server is running.".into())
            }
            other => AppError::Invalid(other.to_string()),
        })?;
    reply.body().deserialize::<u32>().map_err(|e| AppError::Invalid(e.to_string()))
}

/// Run `work`, showing `activity` in the island if it takes longer than a moment. Progress
/// (0..1) is read from `progress` a few times a second. Island errors never affect the work.
pub async fn while_working<T>(
    id: &str,
    activity: Activity,
    progress: tokio::sync::watch::Receiver<Option<f64>>,
    work: impl std::future::Future<Output = T>,
) -> T {
    tokio::pin!(work);
    let mut shown = false;
    let mut tick = tokio::time::interval_at(
        tokio::time::Instant::now() + std::time::Duration::from_millis(700),
        std::time::Duration::from_millis(250),
    );
    let result = loop {
        tokio::select! {
            result = &mut work => break result,
            _ = tick.tick() => {
                let current = Activity { progress: *progress.borrow(), ..activity.clone() };
                shown = show(id, &current).await.is_ok() || shown;
            }
        }
    };
    if shown {
        let _ = end(id).await;
    }
    result
}
