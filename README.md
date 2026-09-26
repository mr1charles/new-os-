# NewOS

A macOS-style operating system for everyday laptops, starting with an HP 14" / Pavilion x360
(11th-gen Intel). NewOS is a Linux distribution with its own desktop built from scratch:

- **Dynamic Island.** A black pill at the top of the screen that morphs to show what's
  happening: notifications, music, volume and brightness, charging, timers, installs, and the
  assistant.
- **A built-in assistant.** It uses Claude in the cloud when you're online and have a key.
  Otherwise it runs a model on the laptop through Ollama. It can change settings, open apps,
  find files, write notes, set timers, and remember things about you.
- **Dual Space.** One password field at login: each password (or fingerprint or face) opens its
  own private space with separate apps, files, and settings.
- **A familiar desktop.** Menu bar, Dock with magnification, Spotlight and Launchpad, Control
  Center, Notification Center, app switcher, and light and dark wallpapers.
- **Apps with intelligence built in.** Settings, Files, Notes, Terminal, Mail (Gmail and
  iCloud), Messages (text without a phone), Calendar, and an App Store for Flatpak, Windows
  `.exe` (Wine), and Android `.apk` (Waydroid) apps.

> **Status:** early development. Milestones 0–2 are done: the monorepo, design system,
> desktop shell, and assistant daemon. The bootable ISO arrives in milestone 8.
> See [docs/ROADMAP.md](docs/ROADMAP.md).

## How it's built

NewOS reuses the Linux kernel, drivers, and the Hyprland Wayland compositor. Everything you
see and touch is built in this repo.

| Layer | Technology | Where |
|---|---|---|
| Apps | Tauri 2 + React + TypeScript | [`apps/`](apps) (Settings so far) |
| App UI kit and SDK | React components; typed IPC, settings, assistant | [`packages/ui/`](packages/ui), [`packages/sdk/`](packages/sdk) |
| Desktop shell | AGS/Astal (TypeScript, GTK4, layer-shell) | [`shell/`](shell) |
| Assistant | Rust daemon, Claude API + Ollama | [`services/assistantd/`](services/assistantd) |
| System integration | Rust libraries | [`services/syslib/`](services/syslib), [`services/appkit/`](services/appkit) |
| Design system | tokens → GTK CSS + web CSS | [`packages/design-tokens/`](packages/design-tokens) |
| Base | Arch Linux, linux-zen, Hyprland, greetd | `distro/` (milestone 8) |

The full picture is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Try it

You need an Arch-based Linux machine (or VM) for the desktop. The checks run anywhere with
Node 22 and Rust (plus WebKitGTK 4.1 for the app backends):

```bash
pnpm install
pnpm check             # design tokens, typecheck, lint, format, 122 unit tests
cargo test --workspace # daemon, system libraries, app backends: 116 tests
```

The Settings app's interface also runs in any browser against sample data:

```bash
pnpm --filter @newos/settings dev   # then open http://localhost:1420
```

To try the whole OS on a Linux machine without installing anything, use testing mode: a
rootless container with everything NewOS needs, using your real Wi-Fi, sound, and Bluetooth
([details](docs/DEVELOPING.md#testing-mode-the-whole-os-in-a-container)):

```bash
scripts/live.sh create   # once, ~20-30 minutes
scripts/live.sh run      # NewOS in a window (or full screen from a text console)
```

## Docs

- [Architecture](docs/ARCHITECTURE.md): layers, processes, files, and security model
- [Roadmap](docs/ROADMAP.md): milestones and what's done
- [Developing](docs/DEVELOPING.md): setup, running the shell, tests
- [Assistant](docs/ASSISTANT.md): setup, privacy, tools, and the local API
- [Hardware](docs/HARDWARE.md): the HP laptop, drivers, and a checklist to run on it

## License

MIT. Wallpapers and icons in `shell/assets` are original artwork under the same license.
NewOS is an independent project, not affiliated with Apple or HP.
