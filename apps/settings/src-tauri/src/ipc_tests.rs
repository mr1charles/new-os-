//! Commands invoked through Tauri's IPC layer on the mock runtime, with the same JSON the
//! frontend sends (camelCase arguments). This catches argument-name and type mismatches
//! between `@helixos/sdk` and the Rust signatures, which unit tests on either side cannot.
//!
//! Every case here only touches temp files or fails validation before any system tool runs,
//! so the tests are safe on a developer's machine.

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

use helixos_appkit::tauri_app::Common;

use crate::commands::Ctx;

struct Harness {
    _app: App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
    dir: tempfile::TempDir,
}

fn harness() -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let common = Common {
        runner: helixos_syslib::SystemRunner::default(),
        assistant: helixos_appkit::assistant_client::AssistantClient::new(dir.path().join("missing.sock")),
        settings_file: dir.path().join("shell.json"),
        assistant_config: dir.path().join("assistant.toml"),
    };
    let ctx = Ctx { runner: helixos_syslib::SystemRunner::default(), hypr_settings: dir.path().join("hyprland-settings.conf") };
    // The real generated context, so the app's own capabilities (ACL) apply as in production.
    let app = crate::with_commands(mock_builder(), common, ctx).build(tauri::generate_context!()).unwrap();
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    Harness { _app: app, webview, dir }
}

impl Harness {
    fn invoke(&self, cmd: &str, body: Value) -> Result<Value, Value> {
        // The origin the production app loads from on Linux.
        self.invoke_from("tauri://localhost", cmd, body)
    }

    fn invoke_from(&self, origin: &str, cmd: &str, body: Value) -> Result<Value, Value> {
        get_ipc_response(
            &self.webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: origin.parse().unwrap(),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|response| response.deserialize::<Value>().unwrap())
    }
}

#[test]
fn settings_round_trip() {
    let h = harness();
    assert_eq!(h.invoke("settings_read", json!({})).unwrap(), json!({}));
    let updated = h.invoke("settings_update", json!({"patch": {"appearance": {"accent": "pink"}}})).unwrap();
    assert_eq!(updated, json!({"appearance": {"accent": "pink"}}));
    assert!(h.dir.path().join("shell.json").exists());
}

#[test]
fn assistant_settings_take_field_and_value() {
    let h = harness();
    let settings = h.invoke("assistant_settings_set", json!({"field": "effort", "value": "high"})).unwrap();
    assert_eq!(settings["effort"], "high");
    let error = h.invoke("assistant_settings_set", json!({"field": "effort", "value": "extreme"})).unwrap_err();
    assert!(error.as_str().unwrap().contains("effort"), "{error}");
}

#[test]
fn assistant_errors_arrive_as_readable_strings() {
    let h = harness();
    let error = h.invoke("assistant_request", json!({"method": "GET", "path": "/v1/status"})).unwrap_err();
    assert!(error.as_str().unwrap().starts_with("the assistant is not running"), "{error}");
    let error = h.invoke("assistant_request", json!({"method": "GET", "path": "/etc/passwd"})).unwrap_err();
    assert!(error.as_str().unwrap().contains("not an assistant API path"), "{error}");
}

#[test]
fn system_commands_validate_their_arguments() {
    let h = harness();
    let cases = [
        ("wifi_connect", json!({"ssid": "", "password": null})),
        ("wifi_forget", json!({"ssid": "x".repeat(40)})),
        ("bluetooth_pair", json!({"address": "not-an-address"})),
        ("power_profile_set", json!({"profile": "turbo"})),
        ("hypr_option_set", json!({"key": "exec-once", "value": "true"})),
        (
            "monitor_apply",
            json!({"setup": {"name": "eDP-1,evil", "mode": "preferred", "x": 0, "y": 0, "scale": 1.0, "transform": 0, "disabled": false}}),
        ),
    ];
    for (cmd, body) in cases {
        let error = h.invoke(cmd, body).expect_err(cmd);
        // A validation message from our code: not a permission error, and not a
        // deserialization failure ("missing field", "invalid type").
        let message = error.as_str().unwrap_or_default();
        assert!(
            !message.is_empty() && !message.contains("not allowed") && !message.contains("missing") && !message.contains("invalid type"),
            "{cmd}: {message}"
        );
    }
}

#[test]
fn missing_arguments_are_reported() {
    let h = harness();
    let error = h.invoke("wifi_connect", json!({"password": "x"})).unwrap_err();
    assert!(error.as_str().unwrap().contains("ssid"), "{error}");
}

#[test]
fn remote_pages_cannot_call_commands() {
    let h = harness();
    let error = h.invoke_from("https://example.com", "settings_read", json!({})).unwrap_err();
    assert!(error.as_str().unwrap().contains("not allowed"), "{error}");
}
