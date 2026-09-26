//! The D-Bus interface `org.newos.Spaces1` at `/org/newos/Spaces1`. Results are JSON strings,
//! which both the shell (GJS) and the apps read easily.
//!
//! | Method | Who may call |
//! |---|---|
//! | `ListSpaces() -> s` | root, the greeter, space accounts |
//! | `ResolvePassword(s password) -> s account` | root, the greeter, space accounts (rate limited) |
//! | `CreateSpace(s name, s password, s accent) -> s space` | administrators (polkit) |
//! | `DeleteSpace(s account, b keep_home)` | administrators (polkit) |
//! | `RenameSpace(s account, s name)`, `SetAccent(s account, s accent)`, `SetDefault(s account)` | administrators (polkit) |
//! | `SetPassword(s account, s password)` | administrators (polkit) |
//!
//! Signal `SpacesChanged()` after any change.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use newos_syslib::CommandRunner;
use tokio::sync::Mutex;
use zbus::message::Header;
use zbus::object_server::SignalEmitter;
use zbus::zvariant::Value;
use zbus::{interface, Connection};

use crate::auth::Authenticator;
use crate::callers::AccountFiles;
use crate::ratelimit::RateLimiter;
use crate::registry::{check_accent, check_name, Registry, Space};
use crate::{accounts, password_taken, resolve};

pub const BUS_NAME: &str = "org.newos.Spaces1";
pub const OBJECT_PATH: &str = "/org/newos/Spaces1";
pub const MANAGE_ACTION: &str = "org.newos.spaces.manage";

#[derive(Debug, zbus::DBusError)]
#[zbus(prefix = "org.newos.Spaces1.Error")]
pub enum SpacesError {
    #[zbus(error)]
    ZBus(zbus::Error),
    AccessDenied(String),
    NoMatch(String),
    RateLimited(String),
    Invalid(String),
    Failed(String),
}

impl From<crate::Error> for SpacesError {
    fn from(e: crate::Error) -> Self {
        match e {
            crate::Error::Invalid(m) => SpacesError::Invalid(m),
            other => SpacesError::Failed(other.to_string()),
        }
    }
}

type Result<T> = std::result::Result<T, SpacesError>;

/// How management calls are authorized.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Authorization {
    /// polkit `org.newos.spaces.manage` (the installed system service).
    Polkit,
    /// Development on a session bus: only the uid running the service may manage, and
    /// ResolvePassword answers only that uid. Never used on the system bus.
    SameUser,
}

pub struct Service {
    pub registry: Mutex<Registry>,
    pub auth: Arc<dyn Authenticator>,
    pub runner: Arc<dyn CommandRunner>,
    pub limiter: Mutex<RateLimiter>,
    pub callers: AccountFiles,
    pub authorization: Authorization,
    /// The service's own uid, for [`Authorization::SameUser`].
    pub own_uid: u32,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

async fn sender_uid(connection: &Connection, header: &Header<'_>) -> Result<(String, u32)> {
    let sender = header.sender().ok_or_else(|| SpacesError::AccessDenied("no sender".into()))?.to_owned();
    let dbus = zbus::fdo::DBusProxy::new(connection).await.map_err(SpacesError::ZBus)?;
    let uid = dbus.get_connection_unix_user(sender.clone().into()).await.map_err(|e| SpacesError::Failed(e.to_string()))?;
    Ok((sender.to_string(), uid))
}

impl Service {
    async fn require_resolver(&self, connection: &Connection, header: &Header<'_>) -> Result<u32> {
        let (_, uid) = sender_uid(connection, header).await?;
        let allowed = match self.authorization {
            Authorization::Polkit => self.callers.may_resolve(uid),
            Authorization::SameUser => uid == self.own_uid,
        };
        if allowed {
            Ok(uid)
        } else {
            Err(SpacesError::AccessDenied("Only the login screen and spaces may ask this.".into()))
        }
    }

    async fn require_admin(&self, connection: &Connection, header: &Header<'_>) -> Result<()> {
        let (sender, uid) = sender_uid(connection, header).await?;
        match self.authorization {
            Authorization::SameUser if uid == self.own_uid => Ok(()),
            Authorization::SameUser => Err(SpacesError::AccessDenied("not the service's user".into())),
            Authorization::Polkit => {
                let subject: (&str, HashMap<&str, Value<'_>>) =
                    ("system-bus-name", HashMap::from([("name", Value::from(sender.as_str()))]));
                let details: HashMap<&str, &str> = HashMap::new();
                // Flag 1: the user may be asked for an administrator password.
                let reply = connection
                    .call_method(
                        Some("org.freedesktop.PolicyKit1"),
                        "/org/freedesktop/PolicyKit1/Authority",
                        Some("org.freedesktop.PolicyKit1.Authority"),
                        "CheckAuthorization",
                        &(subject, MANAGE_ACTION, details, 1u32, ""),
                    )
                    .await
                    .map_err(|e| SpacesError::Failed(format!("polkit: {e}")))?;
                let (authorized, _challenge, _details): (bool, bool, HashMap<String, String>) =
                    reply.body().deserialize().map_err(|e| SpacesError::Failed(format!("polkit: {e}")))?;
                if authorized {
                    Ok(())
                } else {
                    Err(SpacesError::AccessDenied("An administrator has to approve changes to spaces.".into()))
                }
            }
        }
    }

    async fn check_blocking<T: Send + 'static>(&self, f: impl FnOnce(&dyn Authenticator) -> T + Send + 'static) -> Result<T> {
        let auth = self.auth.clone();
        tokio::task::spawn_blocking(move || f(auth.as_ref())).await.map_err(|e| SpacesError::Failed(e.to_string()))
    }

    /// Refuse a password that already opens another space.
    async fn ensure_unique(&self, password: &str, except: Option<&str>) -> Result<()> {
        let snapshot = self.registry.lock().await.snapshot();
        let (password, except) = (password.to_string(), except.map(str::to_string));
        let taken =
            self.check_blocking(move |auth| password_taken(&snapshot, auth, &password, except.as_deref()).map(|s| s.name.clone())).await?;
        match taken {
            Some(name) => Err(SpacesError::Invalid(format!("That password already opens “{name}”. Each space needs its own password."))),
            None => Ok(()),
        }
    }

    async fn save(&self, registry: &Registry, emitter: &SignalEmitter<'_>) -> Result<()> {
        registry.save()?;
        let _ = Self::spaces_changed(emitter).await;
        Ok(())
    }
}

#[interface(name = "org.newos.Spaces1")]
impl Service {
    async fn list_spaces(&self, #[zbus(header)] header: Header<'_>, #[zbus(connection)] connection: &Connection) -> Result<String> {
        self.require_resolver(connection, &header).await?;
        serde_json::to_string(&self.registry.lock().await.spaces).map_err(|e| SpacesError::Failed(e.to_string()))
    }

    /// The account the password opens. Errors: NoMatch, RateLimited (message: seconds).
    async fn resolve_password(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        password: String,
    ) -> Result<String> {
        let uid = self.require_resolver(connection, &header).await?;
        if let Some(wait) = self.limiter.lock().await.wait(uid, Instant::now()) {
            return Err(SpacesError::RateLimited(wait.to_string()));
        }
        let snapshot = self.registry.lock().await.snapshot();
        let found = self.check_blocking(move |auth| resolve(&snapshot, auth, &password).map(|s| s.account.clone())).await?;
        match found {
            Some(account) => {
                self.limiter.lock().await.success(uid);
                let mut registry = self.registry.lock().await;
                registry.touch(&account, now());
                if let Err(e) = registry.save() {
                    tracing::warn!("could not record the last login: {e}");
                }
                tracing::info!(account, "password matched a space");
                Ok(account)
            }
            None => {
                self.limiter.lock().await.failure(uid, Instant::now());
                tracing::info!(uid, "password matched no space");
                Err(SpacesError::NoMatch("That password doesn’t open a space.".into()))
            }
        }
    }

    async fn create_space(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        name: String,
        password: String,
        accent: String,
    ) -> Result<String> {
        self.require_admin(connection, &header).await?;
        let name = check_name(&name)?;
        let accent = check_accent(&accent)?;
        accounts::check_password(&password)?;
        self.ensure_unique(&password, None).await?;
        // A free account name: not in the registry and not an existing system account.
        let mut taken = std::collections::HashSet::new();
        let account = loop {
            let candidate = self.registry.lock().await.new_account(&name, |a| taken.contains(a));
            if !accounts::account_exists(self.runner.as_ref(), &candidate).await {
                break candidate;
            }
            taken.insert(candidate);
            if taken.len() > 50 {
                return Err(SpacesError::Failed("no free account name".into()));
            }
        };
        accounts::create(self.runner.as_ref(), &account, &name, &password).await?;
        let mut registry = self.registry.lock().await;
        registry.add(Space { account: account.clone(), name, accent, default: false, last_used: 0 });
        self.save(&registry, &emitter).await?;
        tracing::info!(account, "created a space");
        serde_json::to_string(registry.get(&account)?).map_err(|e| SpacesError::Failed(e.to_string()))
    }

    async fn delete_space(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        account: String,
        keep_home: bool,
    ) -> Result<()> {
        self.require_admin(connection, &header).await?;
        {
            let registry = self.registry.lock().await;
            registry.get(&account)?;
            if registry.spaces.len() == 1 {
                return Err(SpacesError::Invalid("The last space can’t be deleted.".into()));
            }
        }
        if accounts::has_session(self.runner.as_ref(), &account).await {
            return Err(SpacesError::Invalid("Log out of that space before deleting it.".into()));
        }
        accounts::remove(self.runner.as_ref(), &account, keep_home).await?;
        let mut registry = self.registry.lock().await;
        registry.remove(&account)?;
        self.save(&registry, &emitter).await?;
        tracing::info!(account, keep_home, "deleted a space");
        Ok(())
    }

    async fn rename_space(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        account: String,
        name: String,
    ) -> Result<()> {
        self.require_admin(connection, &header).await?;
        let mut registry = self.registry.lock().await;
        registry.rename(&account, &name)?;
        self.save(&registry, &emitter).await
    }

    async fn set_accent(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        account: String,
        accent: String,
    ) -> Result<()> {
        self.require_admin(connection, &header).await?;
        let mut registry = self.registry.lock().await;
        registry.set_accent(&account, &accent)?;
        self.save(&registry, &emitter).await
    }

    async fn set_default(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        account: String,
    ) -> Result<()> {
        self.require_admin(connection, &header).await?;
        let mut registry = self.registry.lock().await;
        registry.set_default(&account)?;
        self.save(&registry, &emitter).await
    }

    async fn set_password(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        account: String,
        password: String,
    ) -> Result<()> {
        self.require_admin(connection, &header).await?;
        self.registry.lock().await.get(&account)?;
        accounts::check_password(&password)?;
        self.ensure_unique(&password, Some(&account)).await?;
        accounts::set_password(self.runner.as_ref(), &account, &password).await?;
        Ok(())
    }

    #[zbus(signal)]
    async fn spaces_changed(emitter: &SignalEmitter<'_>) -> zbus::Result<()>;
}
