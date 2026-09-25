# Developing NewOS

## What runs where

| Task | Any Linux or macOS with Node 22 + Rust | Arch Linux with a Wayland session |
|---|---|---|
| Typecheck, lint, unit tests | yes | yes |
| Build and test the assistant daemon | yes | yes |
| Run the shell | no | yes |
| Talk to the assistant from the shell | no | yes |

## Setup

```bash
# Node 22 and pnpm 10 (corepack enable), Rust stable
pnpm install
pnpm check              # tokens → typecheck → lint → prettier → vitest
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

### Packages for running the desktop (Arch)

```bash
sudo pacman -S hyprland hypridle hyprlock hyprsunset xdg-desktop-portal-hyprland \
  pipewire wireplumber networkmanager bluez bluez-utils upower power-profiles-daemon \
  brightnessctl grim slurp wl-clipboard libnotify playerctl libcanberra libsecret \
  gtk4 gtk4-layer-shell librsvg inter-font adwaita-icon-theme ollama rustup nodejs pnpm
# AGS and the Astal libraries come from the AUR:
paru -S aylurs-gtk-shell-git libastal-meta
```

## Running the shell

```bash
scripts/dev-session.sh
```

The script builds the design tokens and writes a Hyprland config that sources
`shell/hypr/newos.conf`. That config starts the assistant daemon with `cargo run` and the
shell with `ags run`. Inside an existing Wayland desktop, Hyprland opens as a nested window.
From a text console it takes over the screen. Logs go to `$XDG_RUNTIME_DIR/newos-dev/`.

To iterate on the shell alone inside a running Hyprland session:

```bash
pnpm build:tokens
cd shell && ags run --gtk 4 app.ts     # restart after edits; AGS bundles with esbuild
ags request -i newos help              # commands the keybindings use
ags inspect -i newos                   # GTK inspector
```

`pnpm --filter @newos/shell types` generates full type definitions from the installed Astal
libraries into `shell/@girs/` (git-ignored). CI uses the hand-written declarations in
`shell/types/astal.d.ts`. Extend them when you use a new Astal API.

## Running the assistant daemon

```bash
export ANTHROPIC_API_KEY=...            # or store it in the keyring, see ASSISTANT.md
cargo run -p newos-assistantd -- --tcp 127.0.0.1:7777
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
  `shell/hypr/newos.conf`.
- **New assistant tool:** add it to a module in `services/assistantd/src/tools/`. Give it an
  `object_schema` with `additionalProperties: false`. Write a description that says *when* to
  call it. Set `confirm: true` if it can lose data or leave the machine. The schema test in
  `tools/mod.rs` checks every tool.
- **New system integration:** add a function to `services/syslib` that goes through
  `CommandRunner`, so tests can use `MockRunner`.

## Style

TypeScript follows Prettier (no semicolons, 100 columns) and ESLint with type-only imports.
Rust follows `rustfmt.toml` (140 columns) and clippy with `-D warnings`. User-facing text is
sentence case and plain language.

## Booting in a VM (from M8)

`scripts/dev-vm.sh` boots `out/newos.iso` in QEMU with UEFI firmware.
