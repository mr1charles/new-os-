# Developing HelixOS

## What runs where

| Task | Any Linux or macOS with Node 22 + Rust | Arch Linux with a Wayland session |
|---|---|---|
| Typecheck, lint, unit tests | yes | yes |
| Build and test the assistant daemon | yes | yes |
| Run the shell | no | yes |
| Talk to the assistant from the shell | no | yes |

## Setup

```bash
# Node 22 and pnpm 10 (corepack enable), and rustup: it installs the Rust version pinned in
# rust-toolchain.toml (1.98.1) the first time you run cargo
pnpm install
pnpm check              # tokens → typecheck → lint → prettier → vitest
cargo test --workspace  # app backends link WebKitGTK: install webkit2gtk-4.1 first
cargo clippy --workspace --all-targets -- -D warnings
```

On CachyOS, the distribution's `rust` package links with `x86_64-linux-gnu-gcc`, which is not
installed. Use rustup's toolchain, or run cargo with `CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=cc`.

### Packages for running the desktop (Arch)

```bash
sudo pacman -S hyprland hypridle hyprlock hyprsunset xdg-desktop-portal-hyprland \
  pipewire wireplumber networkmanager bluez bluez-utils upower power-profiles-daemon \
  brightnessctl grim slurp wl-clipboard libnotify playerctl libcanberra libsecret \
  gtk4 gtk4-layer-shell librsvg inter-font adwaita-icon-theme ollama rustup nodejs pnpm \
  webkit2gtk-4.1 pacman-contrib fprintd
# AGS and the Astal libraries come from the AUR:
paru -S aylurs-gtk-shell-git libastal-meta
```

## Testing mode: the whole OS in a container

`scripts/live.sh` runs the complete HelixOS desktop on this machine without installing anything
on the host and without root. It builds a rootless Arch Linux container (user namespaces, the
ranges in `/etc/subuid`), installs Hyprland, AGS/Astal, WebKitGTK and the rest inside it, and
builds HelixOS from this checkout.

```bash
scripts/live.sh create     # once: ~3 GB download and 20-30 minutes; lands in ~/.local/share/helixos-live
scripts/live.sh run        # start HelixOS
scripts/live.sh update     # rebuild the assistant and apps after you pull or edit
scripts/live.sh exec hyprctl configerrors   # run a command in the running session
scripts/live.sh shell      # a shell inside the container (`shell root` for root)
scripts/live.sh remove     # delete the container
```

- **In a window** (started from your desktop): shortcuts use **Alt** instead of Super, because
  the host keeps Super. Alt+Space is the assistant, Alt+A search, Alt+, Settings.
- **Full screen** (started from a text console, Ctrl+Alt+F3): the real Super key, like the
  installed OS.
- The container shares the host's network, GPU, PipeWire, and system services
  (NetworkManager, BlueZ, UPower, fprintd, power profiles), so Wi-Fi, Bluetooth, volume, and
  the fingerprint reader in HelixOS are the real ones. Screen brightness needs the full-screen
  mode (logind only lets the active session change it).
- It has its own home folder, so HelixOS settings never touch the host desktop's. The assistant
  uses the host's Ollama; the first run picks a model that is already pulled.
- The shell runs from this checkout: edit `shell/`, then restart it with
  `scripts/live.sh exec pkill gjs` followed by `scripts/live.sh exec sh -c 'cd $HELIXOS_REPO/shell && ags run --gtk 4 app.ts &'`,
  or just restart the session.
- Logs: `~/.local/share/helixos-live/root/home/$USER/.local/state/helixos-live/`.

## Running the shell

```bash
scripts/dev-session.sh
```

The script builds the design tokens and writes a Hyprland config that sources
`shell/hypr/helixos.conf`. That config starts the assistant daemon with `cargo run` and the
shell with `ags run`. Inside an existing Wayland desktop, Hyprland opens as a nested window.
From a text console it takes over the screen. Logs go to `$XDG_RUNTIME_DIR/helixos-dev/`.

To iterate on the shell alone inside a running Hyprland session:

```bash
pnpm build:tokens
cd shell && ags run --gtk 4 app.ts     # restart after edits; AGS bundles with esbuild
ags request -i helixos help              # commands the keybindings use
ags inspect -i helixos                   # GTK inspector
```

`pnpm --filter @helixos/shell types` generates full type definitions from the installed Astal
libraries into `shell/@girs/` (git-ignored). CI uses the hand-written declarations in
`shell/types/astal.d.ts`. Extend them when you use a new Astal API.

## Apps

Apps live in `apps/<name>` with a React frontend (`src/`) and a Rust backend (`src-tauri/`).
They share `@helixos/ui` for the look and `@helixos/sdk` for everything that talks to the system.

```bash
# The interface in any browser, against sample data (no Tauri, no Linux desktop needed)
pnpm --filter @helixos/settings dev            # http://localhost:1420, ?page=wifi opens a page
pnpm --filter @helixos/calculator dev          # :1421   (notes :1422, terminal :1423, files :1424)

# The real app, talking to this machine (needs webkit2gtk-4.1)
pnpm --filter @helixos/settings tauri dev

# A standalone debug build that scripts/dev-session.sh puts on PATH as helixos-settings
pnpm --filter @helixos/settings tauri build --debug --no-bundle
```

Settings changes the real system: Wi-Fi, Bluetooth, volume, brightness, displays, power mode,
and Hyprland input options (applied live and saved to `~/.config/helixos/hyprland-settings.conf`).
Display changes revert after 15 seconds unless you keep them.

A new app: draw `apps/<id>/src-tauri/icons/icon.svg`, then run
`scripts/new-app.py <id> --title ... --port 14xx --comment ... --categories ...`. It writes the
Tauri side (manifest, config, capabilities, `main.rs` on `helixos_appkit::tauri_app`, rendered
icons, the `.desktop` file). Copy `package.json`, `index.html`, `vite.config.ts` (with the
port), and `tsconfig.json` from an existing app, start `src/main.tsx` with `startApp(App)`
from `@helixos/ui/start`, and add the crate to the workspace in `Cargo.toml`. Every app gets the
settings and assistant commands for free.

To add a backend command: write the logic in `services/syslib` or `services/appkit` with a
test, wrap it in `apps/<app>/src-tauri/src/commands.rs`, register it in `main.rs`, type it in
`packages/sdk/src/commands.ts`, and add it to the mock in `packages/sdk/src/mock.ts`. Each
app's `src/backend.test.ts` checks that every command its frontend calls is registered, that
everything registered is typed in the SDK, and that the mock covers the SDK.

`cargo run -p helixos-syslib --example probe` prints what Settings reads on the current machine
(networks, audio devices, monitors, battery, Hyprland options), which helps when a parser meets
new output.

## Running the assistant daemon

```bash
export ANTHROPIC_API_KEY=...            # or store it in the keyring, see ASSISTANT.md
cargo run -p helixos-assistantd -- --tcp 127.0.0.1:7777
curl -s localhost:7777/v1/status | jq
curl -sN localhost:7777/v1/chat -H 'content-type: application/json' -d '{"message":"set a 1 minute timer"}'
```

Without a key or network, install Ollama and pull the local model (`ollama pull qwen2.5:3b`).
The daemon uses it automatically.

## Where things go

- **Pure logic belongs in `shell/lib/`** with no `gi://` imports, plus a `*.test.ts` next to it.
- **New island activity:** add a payload type and priority in `shell/lib/island-queue.ts`, a
  page in `shell/widgets/island/views.tsx`, and a source in `shell/lib/island-sources.ts`.
- **New shell command:** add a case to `shell/lib/requests.ts` and bind it in
  `shell/hypr/helixos.conf`.
- **New assistant tool:** add it to a module in `services/assistantd/src/tools/`. Give it an
  `object_schema` with `additionalProperties: false`. Write a description that says *when* to
  call it. Set `confirm: true` if it can lose data or leave the machine. The schema test in
  `tools/mod.rs` checks every tool.
- **New system integration:** add a function to `services/syslib` that goes through
  `CommandRunner`, so tests can use `MockRunner`. Capture the tool's real output for the test.
- **New Settings page:** add the id to `packages/sdk/src/settings-pages.ts` (Spotlight finds
  it there), then a component in `apps/settings/src/pages/` and an entry in
  `apps/settings/src/pages.tsx`. A test renders every page against the mock backend.

## Style

TypeScript follows Prettier (no semicolons, 100 columns) and ESLint with type-only imports.
Rust follows `rustfmt.toml` (140 columns) and clippy with `-D warnings`. User-facing text is
sentence case and plain language.

## Booting in a VM (from M8)

`scripts/dev-vm.sh` boots `out/helixos.iso` in QEMU with UEFI firmware.
