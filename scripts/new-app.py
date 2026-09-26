#!/usr/bin/env python3
"""Create the Tauri side of a HelixOS app: src-tauri/ (manifest, config, capabilities, main.rs on
helixos_appkit::tauri_app, icons rendered from icons/icon.svg) and the .desktop file.

    scripts/new-app.py <id> --title Notes --port 1422 --size 1000x680 --min 640x420 \\
        --comment "..." --categories "Office;" --keywords "memo;markdown;"

The frontend (package.json, index.html, vite.config.ts, src/) is written by hand. Existing
files are left alone unless --force is given, so it is safe to re-run after editing.
"""
import argparse
import json
import pathlib
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent


def write(path: pathlib.Path, text: str, force: bool):
    if path.exists() and not force:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    print(f"wrote {path.relative_to(ROOT)}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("id")
    p.add_argument("--title", required=True)
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--size", default="900x640")
    p.add_argument("--min", default="480x360")
    p.add_argument("--comment", required=True)
    p.add_argument("--categories", required=True)
    p.add_argument("--keywords", default="")
    p.add_argument("--permissions", default="", help="extra capability permissions, comma separated")
    p.add_argument("--plugins", default="", help="extra tauri plugin crates, comma separated")
    p.add_argument("--force", action="store_true")
    a = p.parse_args()

    app = ROOT / "apps" / a.id
    tauri = app / "src-tauri"
    w, h = (float(x) for x in a.size.split("x"))
    mw, mh = (float(x) for x in a.min.split("x"))
    binary = f"helixos-{a.id}"
    plugins = [x for x in a.plugins.split(",") if x]

    deps = "\n".join(f'{name} = "2"' for name in plugins)
    write(tauri / "Cargo.toml", f'''[package]
name = "{binary}"
description = "HelixOS {a.title} backend."
version.workspace = true
edition.workspace = true
license.workspace = true
repository.workspace = true
rust-version.workspace = true

[[bin]]
name = "{binary}"
path = "src/main.rs"

[build-dependencies]
tauri-build = {{ version = "2", features = [] }}

[dependencies]
helixos-appkit = {{ path = "../../../services/appkit", features = ["tauri"] }}
helixos-syslib = {{ path = "../../../services/syslib" }}
serde = {{ workspace = true }}
serde_json = {{ workspace = true }}
tokio = {{ workspace = true }}
tauri = {{ version = "2", features = ["protocol-asset"] }}
tauri-plugin-single-instance = "2"
{deps}

[dev-dependencies]
tauri = {{ version = "2", features = ["protocol-asset", "test"] }}
tempfile = "3"
''', a.force)
    write(tauri / "build.rs", "fn main() {\n    tauri_build::build()\n}\n", a.force)
    conf = {
        "$schema": "https://schema.tauri.app/config/2",
        "productName": a.title,
        "mainBinaryName": binary,
        "version": "0.1.0",
        "identifier": f"org.helixos.{a.title.replace(' ', '')}",
        "build": {
            "beforeDevCommand": "pnpm dev",
            "devUrl": f"http://localhost:{a.port}",
            "beforeBuildCommand": "pnpm build",
            "frontendDist": "../dist",
        },
        "app": {
            "windows": [],
            "security": {
                "csp": "default-src 'self' ipc: http://ipc.localhost; img-src 'self' asset: http://asset.localhost data: blob:; style-src 'self' 'unsafe-inline'; media-src 'self' asset: http://asset.localhost",
                "assetProtocol": {"enable": True, "scope": ["$HOME/**", "/usr/share/**", "/run/media/**", "/media/**"]},
            },
        },
        "bundle": {"active": False, "icon": ["icons/32x32.png", "icons/128x128.png", "icons/256x256.png", "icons/icon.png"]},
    }
    write(tauri / "tauri.conf.json", json.dumps(conf, indent=2) + "\n", a.force)
    perms = [
        "core:default",
        "core:window:allow-close",
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
        "core:window:allow-start-dragging",
    ] + [x for x in a.permissions.split(",") if x]
    cap = {
        "$schema": "../gen/schemas/desktop-schema.json",
        "identifier": "default",
        "description": f"The {a.title} window.",
        "windows": ["main"],
        "permissions": perms,
    }
    write(tauri / "capabilities" / "default.json", json.dumps(cap, indent=2) + "\n", a.force)
    plugin_lines = "".join(f"        .plugin({name.replace('-', '_')}::init())\n" for name in plugins)
    write(tauri / "src" / "main.rs", f'''//! HelixOS {a.title}.

use helixos_appkit::tauri_app::{{setup, with_common_commands, Common, WindowSpec}};
use tauri::{{Manager, Runtime}};

/// Register the state and every command (the shared ones from appkit plus the app's own).
/// Separate from `main` so tests can build the same app on Tauri's mock runtime.
fn with_commands<R: Runtime>(builder: tauri::Builder<R>, common: Common) -> tauri::Builder<R> {{
    // The app's own commands go in this list (add a `commands` module when it has some).
    builder.manage(common).invoke_handler(with_common_commands(tauri::generate_handler![]))
}}

fn main() {{
    with_commands(tauri::Builder::default(), Common::from_env())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {{
            if let Some(window) = app.get_webview_window("main") {{
                let _ = window.unminimize();
                let _ = window.set_focus();
            }}
        }}))
{plugin_lines}        .setup(|app| {{
            setup(app, WindowSpec {{ title: "{a.title}", url: "index.html".into(), size: ({w}, {h}), min_size: ({mw}, {mh}) }})
        }})
        .run(tauri::generate_context!())
        .expect("{a.title} failed to start");
}}
''', a.force)
    write(app / f"{binary}.desktop", f'''[Desktop Entry]
Type=Application
Name={a.title}
Comment={a.comment}
Exec={binary}
Icon={binary}
Terminal=false
Categories={a.categories}
Keywords={a.keywords}
''', a.force)

    svg = tauri / "icons" / "icon.svg"
    if svg.exists() and shutil.which("rsvg-convert"):
        for size in (32, 128, 256, 512):
            subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), str(svg), "-o", str(tauri / "icons" / f"{size}x{size}.png")], check=True)
        shutil.copy(tauri / "icons" / "512x512.png", tauri / "icons" / "icon.png")
        print("rendered icons")
    elif not svg.exists():
        print(f"add {svg.relative_to(ROOT)} and re-run to render the icons")


if __name__ == "__main__":
    main()
