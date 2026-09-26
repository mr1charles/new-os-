//! A client for newos-spacesd (org.newos.Spaces1), for Settings → Users & Spaces. On the system
//! bus; `NEWOS_SPACES_BUS=session` points at a development instance. Changes ask polkit for
//! an administrator, so a password prompt may appear.

use serde::{Deserialize, Serialize};

use crate::{AppError, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Space {
    pub account: String,
    pub name: String,
    pub accent: String,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub last_used: u64,
}

const NAME: &str = "org.newos.Spaces1";
const PATH: &str = "/org/newos/Spaces1";

async fn connection() -> Result<zbus::Connection> {
    let session = std::env::var("NEWOS_SPACES_BUS").is_ok_and(|v| v == "session");
    let conn = if session { zbus::Connection::session().await } else { zbus::Connection::system().await };
    conn.map_err(|e| AppError::Invalid(format!("Can’t reach the system bus: {e}")))
}

/// spacesd's errors carry a message meant for people; D-Bus plumbing errors get a plain one.
fn readable(error: zbus::Error) -> AppError {
    match error {
        zbus::Error::MethodError(name, message, _) => {
            let name = name.as_str();
            if name.ends_with("ServiceUnknown") || name.ends_with("NameHasNoOwner") {
                AppError::Invalid("The space service (newos-spacesd) isn’t running.".into())
            } else if name == "org.freedesktop.DBus.Error.AccessDenied" {
                AppError::Invalid("This account isn’t allowed to manage spaces.".into())
            } else {
                AppError::Invalid(message.unwrap_or_else(|| name.to_string()))
            }
        }
        other => AppError::Invalid(other.to_string()),
    }
}

async fn call<B>(method: &str, body: &B) -> Result<zbus::Message>
where
    B: serde::Serialize + zbus::zvariant::DynamicType,
{
    let conn = connection().await?;
    // spacesd asks polkit with user interaction allowed, so an administrator prompt can appear
    // (from the session's polkit agent) while this call waits.
    conn.call_method(Some(NAME), PATH, Some(NAME), method, body).await.map_err(readable)
}

pub fn parse_spaces(json: &str) -> Result<Vec<Space>> {
    Ok(serde_json::from_str(json)?)
}

pub async fn list() -> Result<Vec<Space>> {
    let reply = call("ListSpaces", &()).await?;
    parse_spaces(&reply.body().deserialize::<String>().map_err(|e| AppError::Invalid(e.to_string()))?)
}

pub async fn create(name: &str, password: &str, accent: &str) -> Result<Space> {
    let reply = call("CreateSpace", &(name, password, accent)).await?;
    Ok(serde_json::from_str(&reply.body().deserialize::<String>().map_err(|e| AppError::Invalid(e.to_string()))?)?)
}

pub async fn delete(account: &str, keep_home: bool) -> Result<()> {
    call("DeleteSpace", &(account, keep_home)).await.map(|_| ())
}

pub async fn rename(account: &str, name: &str) -> Result<()> {
    call("RenameSpace", &(account, name)).await.map(|_| ())
}

pub async fn set_accent(account: &str, accent: &str) -> Result<()> {
    call("SetAccent", &(account, accent)).await.map(|_| ())
}

pub async fn set_default(account: &str) -> Result<()> {
    call("SetDefault", &(account,)).await.map(|_| ())
}

pub async fn set_password(account: &str, password: &str) -> Result<()> {
    call("SetPassword", &(account, password)).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_list() {
        let spaces = parse_spaces(r#"[{"account":"space-work","name":"Work","accent":"blue","default":true,"last_used":3}]"#).unwrap();
        assert_eq!(spaces[0].name, "Work");
        assert!(spaces[0].default);
        assert!(parse_spaces("nope").is_err());
    }

    #[test]
    fn keeps_service_messages_readable() {
        let err = readable(zbus::Error::MethodError(
            zbus::names::OwnedErrorName::try_from("org.newos.Spaces1.Error.Invalid").unwrap(),
            Some("That password already opens “Work”.".into()),
            zbus::message::Message::method_call("/", "x").unwrap().build(&()).unwrap(),
        ));
        assert_eq!(err.to_string(), "That password already opens “Work”.");
    }
}
