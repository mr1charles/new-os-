//! A client for assistantd's HTTP API on its unix socket. App webviews cannot open unix
//! sockets, so their Rust backends forward requests here: plain JSON calls, and streamed
//! responses (chat) passed through chunk by chunk for `@helixos/sdk` to parse as SSE.

use std::path::{Path, PathBuf};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::{Method, Request, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::Value;
use tokio::net::UnixStream;

use crate::{AppError, Result};

#[derive(Debug, Clone)]
pub struct AssistantClient {
    socket: PathBuf,
}

/// Only API paths are forwarded; anything else from the webview is refused.
pub fn valid_path(path: &str) -> bool {
    path.starts_with("/v1/") && path.len() < 256 && !path.contains("..") && path.chars().all(|c| c.is_ascii_graphic())
}

impl AssistantClient {
    pub fn new(socket: impl Into<PathBuf>) -> Self {
        Self { socket: socket.into() }
    }

    /// `$XDG_RUNTIME_DIR/helixos/assistant.sock`
    pub fn from_env() -> Self {
        Self::new(crate::paths::assistant_socket())
    }

    pub fn socket(&self) -> &Path {
        &self.socket
    }

    async fn send(&self, method: &str, path: &str, body: Option<&Value>) -> Result<hyper::Response<hyper::body::Incoming>> {
        if !valid_path(path) {
            return Err(AppError::Invalid(format!("not an assistant API path: {path}")));
        }
        let method = Method::from_bytes(method.as_bytes()).map_err(|_| AppError::Invalid(format!("bad method {method}")))?;
        let stream = UnixStream::connect(&self.socket)
            .await
            .map_err(|e| AppError::AssistantUnavailable(format!("{}: {e}", self.socket.display())))?;
        let (mut sender, connection) =
            hyper::client::conn::http1::handshake(TokioIo::new(stream)).await.map_err(|e| AppError::AssistantUnavailable(e.to_string()))?;
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                tracing::debug!("assistant connection closed: {e}");
            }
        });
        let body = match body {
            Some(value) => Full::new(Bytes::from(serde_json::to_vec(value)?)),
            None => Full::new(Bytes::new()),
        };
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header("host", "localhost")
            .header("content-type", "application/json")
            .body(body)
            .map_err(|e| AppError::Invalid(e.to_string()))?;
        sender.send_request(request).await.map_err(|e| AppError::AssistantUnavailable(e.to_string()))
    }

    fn error_message(status: StatusCode, body: &[u8]) -> AppError {
        let message = serde_json::from_slice::<Value>(body)
            .ok()
            .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| String::from_utf8_lossy(body).trim().to_string());
        AppError::Assistant { status: status.as_u16(), message }
    }

    /// A JSON request. An empty response body reads as `null`.
    pub async fn request(&self, method: &str, path: &str, body: Option<&Value>) -> Result<Value> {
        let response = self.send(method, path, body).await?;
        let status = response.status();
        let bytes = response.into_body().collect().await.map_err(|e| AppError::AssistantUnavailable(e.to_string()))?.to_bytes();
        if !status.is_success() {
            return Err(Self::error_message(status, &bytes));
        }
        if bytes.is_empty() {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_slice(&bytes)?)
    }

    /// A streamed request: `on_chunk` gets the body as UTF-8 text in the order it arrives
    /// (chunks can split lines; the SDK's SSE parser buffers them).
    pub async fn stream(&self, path: &str, body: &Value, mut on_chunk: impl FnMut(String)) -> Result<()> {
        let response = self.send("POST", path, Some(body)).await?;
        let status = response.status();
        let mut body = response.into_body();
        if !status.is_success() {
            let bytes = body.collect().await.map_err(|e| AppError::AssistantUnavailable(e.to_string()))?.to_bytes();
            return Err(Self::error_message(status, &bytes));
        }
        // Hold back an incomplete UTF-8 sequence at a chunk boundary until the rest arrives.
        let mut pending: Vec<u8> = Vec::new();
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(|e| AppError::AssistantUnavailable(e.to_string()))?;
            let Ok(data) = frame.into_data() else { continue };
            pending.extend_from_slice(&data);
            let valid = match std::str::from_utf8(&pending) {
                Ok(_) => pending.len(),
                Err(e) => e.valid_up_to(),
            };
            if valid > 0 {
                let rest = pending.split_off(valid);
                on_chunk(String::from_utf8(std::mem::replace(&mut pending, rest)).expect("checked above"));
            }
        }
        if !pending.is_empty() {
            on_chunk(String::from_utf8_lossy(&pending).into_owned());
        }
        Ok(())
    }
}

/// Restart the daemon so it reads a changed assistant.toml or keyring entry. In the installed
/// session systemd restarts it; where it is not a systemd unit (the preview runs it in a
/// restart loop), stopping it is enough for its supervisor to start it again.
pub async fn restart_daemon(runner: &dyn helixos_syslib::CommandRunner) -> Result<()> {
    let active = runner
        .run("systemctl", &["--user".into(), "is-active".into(), "--quiet".into(), "helixos-assistantd.service".into()])
        .await
        .is_ok_and(|o| o.success());
    if active {
        helixos_syslib::runner::run_checked(runner, "systemctl", &["--user", "restart", "helixos-assistantd.service"]).await?;
    } else {
        // Exit status 1 means no such process, which is fine: there is nothing to restart.
        let _ = runner.run("pkill", &["-TERM".into(), "-x".into(), "helixos-assistantd".into()]).await;
    }
    Ok(())
}

#[cfg(test)]
mod restart_tests {
    use super::restart_daemon;
    use helixos_syslib::{CommandOutput, MockRunner};

    #[tokio::test]
    async fn restarts_through_systemd_or_stops_it_for_its_supervisor() {
        let systemd = MockRunner::new();
        systemd.respond(CommandOutput::ok("")).respond(CommandOutput::ok(""));
        restart_daemon(&systemd).await.unwrap();
        assert_eq!(systemd.calls()[1], ["systemctl", "--user", "restart", "helixos-assistantd.service"]);

        let preview = MockRunner::new();
        preview.respond(CommandOutput::failed(1, "Failed to connect to bus")).respond(CommandOutput::ok(""));
        restart_daemon(&preview).await.unwrap();
        assert_eq!(preview.calls()[1], ["pkill", "-TERM", "-x", "helixos-assistantd"]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixListener;

    /// A one-shot HTTP server on a unix socket that answers with `response` verbatim.
    async fn serve_once(response: &'static str) -> (tempfile::TempDir, AssistantClient, tokio::task::JoinHandle<String>) {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("assistant.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let handle = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![0u8; 4096];
            let n = stream.read(&mut request).await.unwrap();
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.shutdown().await.unwrap();
            String::from_utf8_lossy(&request[..n]).into_owned()
        });
        (dir, AssistantClient::new(socket), handle)
    }

    #[test]
    fn only_api_paths_are_forwarded() {
        assert!(valid_path("/v1/status"));
        assert!(valid_path("/v1/facts/abc-123"));
        assert!(!valid_path("/admin"));
        assert!(!valid_path("/v1/../etc"));
        assert!(!valid_path("/v1/a b"));
    }

    #[tokio::test]
    async fn sends_json_requests() {
        let (_dir, client, server) =
            serve_once("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 18\r\n\r\n{\"active\":\"local\"}").await;
        let status = client.request("GET", "/v1/status", None).await.unwrap();
        assert_eq!(status["active"], "local");
        let request = server.await.unwrap();
        assert!(request.starts_with("GET /v1/status HTTP/1.1\r\n"));
    }

    #[tokio::test]
    async fn reports_api_errors_with_their_message() {
        let (_dir, client, _server) =
            serve_once("HTTP/1.1 400 Bad Request\r\ncontent-length: 25\r\n\r\n{\"error\":\"unknown task\"}\n").await;
        let error = client.request("POST", "/v1/complete", Some(&serde_json::json!({}))).await.unwrap_err();
        assert_eq!(error.to_string(), "the assistant answered 400: unknown task");
    }

    #[tokio::test]
    async fn streams_chunked_bodies() {
        let response = "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n\
                        f\r\ndata: {\"a\":1}\n\n\r\n\
                        f\r\ndata: {\"b\":2}\n\n\r\n0\r\n\r\n";
        let (_dir, client, server) = serve_once(response).await;
        let mut text = String::new();
        client.stream("/v1/chat", &serde_json::json!({"message": "hi"}), |chunk| text.push_str(&chunk)).await.unwrap();
        assert_eq!(text, "data: {\"a\":1}\n\ndata: {\"b\":2}\n\n");
        let request = server.await.unwrap();
        assert!(request.contains("{\"message\":\"hi\"}"));
    }

    #[tokio::test]
    async fn missing_socket_means_not_running() {
        let client = AssistantClient::new("/nonexistent/helixos/assistant.sock");
        assert!(matches!(client.request("GET", "/v1/status", None).await, Err(AppError::AssistantUnavailable(_))));
    }
}
