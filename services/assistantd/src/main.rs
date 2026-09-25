use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use clap::Parser;
use newos_assistantd::config::{Config, Paths};
use newos_assistantd::{api, AppState};
use tracing_subscriber::EnvFilter;

/// The NewOS assistant daemon.
#[derive(Parser)]
#[command(version, about)]
struct Args {
    /// Config file (default: ~/.config/newos/assistant.toml).
    #[arg(long)]
    config: Option<PathBuf>,
    /// Unix socket to serve on (default: $XDG_RUNTIME_DIR/newos/assistant.sock).
    #[arg(long)]
    socket: Option<PathBuf>,
    /// Also listen on TCP, for development with curl (e.g. 127.0.0.1:7777). Any local user can
    /// reach a TCP port, so never enable this on a shared machine.
    #[arg(long)]
    tcp: Option<String>,
    /// Print the effective configuration and exit.
    #[arg(long)]
    print_config: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))).init();

    let args = Args::parse();
    let paths = Paths::from_env();
    let config_file = args.config.clone().unwrap_or_else(|| paths.config_file.clone());
    let config = Config::load(&config_file)?;
    if args.print_config {
        print!("{}", toml::to_string_pretty(&config)?);
        return Ok(());
    }

    let state = AppState::from_config(config, &paths)?;
    tracing::info!(
        mode = ?state.config.mode,
        cloud = state.cloud.is_some(),
        local_model = %state.config.local.model,
        "assistant ready"
    );
    let app = api::router(state);

    let socket = args.socket.unwrap_or_else(|| paths.socket.clone());
    // sockaddr_un holds at most 107 bytes of path.
    if socket.as_os_str().len() > 107 {
        anyhow::bail!("socket path {} is longer than the 107 bytes unix sockets allow; pass a shorter --socket", socket.display());
    }
    if let Some(dir) = socket.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    if socket.exists() {
        std::fs::remove_file(&socket)?;
    }
    let listener = tokio::net::UnixListener::bind(&socket)?;
    // Only the user may connect; this is the API's access control.
    std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))?;
    tracing::info!("listening on {}", socket.display());

    let unix = axum::serve(listener, app.clone()).with_graceful_shutdown(shutdown());
    match args.tcp {
        Some(addr) => {
            let tcp = tokio::net::TcpListener::bind(&addr).await?;
            tracing::warn!("also listening on http://{addr} (development only)");
            let tcp = axum::serve(tcp, app).with_graceful_shutdown(shutdown());
            tokio::try_join!(async { unix.await }, async { tcp.await })?;
        }
        None => unix.await?,
    }
    let _ = std::fs::remove_file(&socket);
    Ok(())
}

async fn shutdown() {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("signal handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
    tracing::info!("shutting down");
}
