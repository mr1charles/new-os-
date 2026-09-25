use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;
use std::time::Duration;

use crate::{Result, SysError};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommandOutput {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

impl CommandOutput {
    pub fn ok(stdout: impl Into<String>) -> Self {
        Self { status: 0, stdout: stdout.into(), stderr: String::new() }
    }

    pub fn failed(status: i32, stderr: impl Into<String>) -> Self {
        Self { status, stdout: String::new(), stderr: stderr.into() }
    }

    pub fn success(&self) -> bool {
        self.status == 0
    }
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Runs external programs. Implemented by [`SystemRunner`] for real use and [`MockRunner`]
/// for tests.
pub trait CommandRunner: Send + Sync {
    fn run<'a>(&'a self, program: &'a str, args: &'a [String]) -> BoxFuture<'a, Result<CommandOutput>>;

    /// Start a program and do not wait for it (apps, URLs).
    fn spawn_detached<'a>(&'a self, program: &'a str, args: &'a [String]) -> BoxFuture<'a, Result<()>>;
}

/// Run and require success, returning stdout.
pub async fn run_checked(runner: &dyn CommandRunner, program: &str, args: &[&str]) -> Result<String> {
    let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    let output = runner.run(program, &args).await?;
    if output.success() {
        Ok(output.stdout)
    } else {
        let message =
            if output.stderr.trim().is_empty() { format!("exit status {}", output.status) } else { output.stderr.trim().to_string() };
        Err(SysError::Failed { program: program.to_string(), message })
    }
}

/// Runs real commands with a timeout.
#[derive(Debug, Clone)]
pub struct SystemRunner {
    pub timeout: Duration,
}

impl Default for SystemRunner {
    fn default() -> Self {
        Self { timeout: Duration::from_secs(20) }
    }
}

impl CommandRunner for SystemRunner {
    fn run<'a>(&'a self, program: &'a str, args: &'a [String]) -> BoxFuture<'a, Result<CommandOutput>> {
        Box::pin(async move {
            let child = tokio::process::Command::new(program).args(args).stdin(std::process::Stdio::null()).kill_on_drop(true).output();
            let output = match tokio::time::timeout(self.timeout, child).await {
                Err(_) => return Err(SysError::Failed { program: program.to_string(), message: "timed out".into() }),
                Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Err(SysError::NotInstalled { program: program.to_string() })
                }
                Ok(Err(e)) => return Err(e.into()),
                Ok(Ok(output)) => output,
            };
            Ok(CommandOutput {
                status: output.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            })
        })
    }

    fn spawn_detached<'a>(&'a self, program: &'a str, args: &'a [String]) -> BoxFuture<'a, Result<()>> {
        Box::pin(async move {
            match std::process::Command::new(program)
                .args(args)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
            {
                Ok(_) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(SysError::NotInstalled { program: program.to_string() }),
                Err(e) => Err(e.into()),
            }
        })
    }
}

/// Test runner: records every call and answers from a queue of canned outputs.
#[derive(Debug, Default)]
pub struct MockRunner {
    responses: Mutex<VecDeque<Result<CommandOutput>>>,
    calls: Mutex<Vec<Vec<String>>>,
}

impl MockRunner {
    pub fn new() -> Self {
        Self::default()
    }

    /// Queue the output for the next `run` call.
    pub fn respond(&self, output: CommandOutput) -> &Self {
        self.responses.lock().unwrap().push_back(Ok(output));
        self
    }

    pub fn respond_err(&self, error: SysError) -> &Self {
        self.responses.lock().unwrap().push_back(Err(error));
        self
    }

    /// Every call so far, as `[program, args...]`.
    pub fn calls(&self) -> Vec<Vec<String>> {
        self.calls.lock().unwrap().clone()
    }

    fn record(&self, program: &str, args: &[String]) {
        let mut call = vec![program.to_string()];
        call.extend(args.iter().cloned());
        self.calls.lock().unwrap().push(call);
    }
}

impl CommandRunner for MockRunner {
    fn run<'a>(&'a self, program: &'a str, args: &'a [String]) -> BoxFuture<'a, Result<CommandOutput>> {
        self.record(program, args);
        let next = self.responses.lock().unwrap().pop_front().unwrap_or_else(|| Ok(CommandOutput::ok("")));
        Box::pin(async move { next })
    }

    fn spawn_detached<'a>(&'a self, program: &'a str, args: &'a [String]) -> BoxFuture<'a, Result<()>> {
        self.record(program, args);
        Box::pin(async { Ok(()) })
    }
}
