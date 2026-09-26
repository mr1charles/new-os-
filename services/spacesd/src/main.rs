//! `helixos-spacesd`: the Dual Space service. Installed, it runs as root on the system bus.
//! `--session` runs it on the session bus for development, where it only answers its own user
//! and nothing needs polkit.

use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use helixos_spacesd::auth::MockAuthenticator;
use helixos_spacesd::callers::AccountFiles;
use helixos_spacesd::ratelimit::RateLimiter;
use helixos_spacesd::registry::{Registry, Space};
use helixos_spacesd::service::{Authorization, Service, BUS_NAME, OBJECT_PATH};
use helixos_syslib::SystemRunner;
use tokio::sync::Mutex;

#[derive(Parser)]
#[command(about = "HelixOS Dual Space service")]
struct Args {
    /// Where the list of spaces is kept.
    #[arg(long, default_value = "/var/lib/helixos/spaces.json")]
    state: PathBuf,
    /// Use the session bus (development). Management then needs no polkit, and only the
    /// service's own user may call it.
    #[arg(long)]
    session: bool,
    /// PAM service for password checks.
    #[arg(long, default_value = "helixos-spaces")]
    pam_service: String,
    /// With --session: two demo spaces with mock accounts, for trying the login screen without
    /// creating users. "Work" opens with work-demo, "Personal" with home-demo.
    #[arg(long, requires = "session")]
    demo: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let args = Args::parse();
    // SAFETY: geteuid has no preconditions and cannot fail.
    let own_uid = unsafe { libc::geteuid() };
    if !args.session && own_uid != 0 {
        anyhow::bail!("the system service must run as root (use --session for development)");
    }

    #[cfg(feature = "pam")]
    let auth: Arc<dyn helixos_spacesd::auth::Authenticator> =
        Arc::new(helixos_spacesd::auth::PamAuthenticator { service: args.pam_service });
    #[cfg(not(feature = "pam"))]
    let auth: Arc<dyn helixos_spacesd::auth::Authenticator> = {
        let _ = args.pam_service;
        anyhow::bail!("built without PAM support")
    };

    let (registry, auth, runner): (Registry, Arc<dyn helixos_spacesd::auth::Authenticator>, Arc<dyn helixos_syslib::CommandRunner>) =
        if args.demo {
            let mut registry = Registry::default();
            for (account, name, accent) in [("space-work", "Work", "blue"), ("space-personal", "Personal", "pink")] {
                registry.add(Space { account: account.into(), name: name.into(), accent: accent.into(), default: false, last_used: 0 });
            }
            let mock = MockAuthenticator::with(&[("space-work", "work-demo"), ("space-personal", "home-demo")]);
            tracing::warn!("demo mode: mock accounts, nothing is changed on this system");
            (registry, Arc::new(mock), Arc::new(helixos_syslib::MockRunner::new()))
        } else {
            (Registry::load(&args.state)?, auth, Arc::new(SystemRunner::default()))
        };
    let service = Service {
        registry: Mutex::new(registry),
        auth,
        runner,
        limiter: Mutex::new(RateLimiter::default()),
        callers: AccountFiles::default(),
        authorization: if args.session { Authorization::SameUser } else { Authorization::Polkit },
        own_uid,
    };
    let builder = if args.session { zbus::connection::Builder::session()? } else { zbus::connection::Builder::system()? };
    let _connection = builder.name(BUS_NAME)?.serve_at(OBJECT_PATH, service)?.build().await?;
    tracing::info!(bus = if args.session { "session" } else { "system" }, "spacesd ready");
    std::future::pending::<()>().await;
    Ok(())
}
