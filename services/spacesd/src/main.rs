//! `newos-spacesd`: the Dual Space service. Installed, it runs as root on the system bus.
//! `--session` runs it on the session bus for development, where it only answers its own user
//! and nothing needs polkit.

use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use newos_spacesd::callers::AccountFiles;
use newos_spacesd::ratelimit::RateLimiter;
use newos_spacesd::registry::Registry;
use newos_spacesd::service::{Authorization, Service, BUS_NAME, OBJECT_PATH};
use newos_syslib::SystemRunner;
use tokio::sync::Mutex;

#[derive(Parser)]
#[command(about = "NewOS Dual Space service")]
struct Args {
    /// Where the list of spaces is kept.
    #[arg(long, default_value = "/var/lib/newos/spaces.json")]
    state: PathBuf,
    /// Use the session bus (development). Management then needs no polkit, and only the
    /// service's own user may call it.
    #[arg(long)]
    session: bool,
    /// PAM service for password checks.
    #[arg(long, default_value = "newos-spaces")]
    pam_service: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let args = Args::parse();
    let own_uid = std::fs::metadata("/proc/self").map(|m| std::os::unix::fs::MetadataExt::uid(&m)).unwrap_or(u32::MAX);
    if !args.session && own_uid != 0 {
        anyhow::bail!("the system service must run as root (use --session for development)");
    }

    #[cfg(feature = "pam")]
    let auth: Arc<dyn newos_spacesd::auth::Authenticator> = Arc::new(newos_spacesd::auth::PamAuthenticator { service: args.pam_service });
    #[cfg(not(feature = "pam"))]
    let auth: Arc<dyn newos_spacesd::auth::Authenticator> = {
        let _ = args.pam_service;
        anyhow::bail!("built without PAM support")
    };

    let service = Service {
        registry: Mutex::new(Registry::load(&args.state)?),
        auth,
        runner: Arc::new(SystemRunner::default()),
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
