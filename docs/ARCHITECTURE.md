# Architecture

NewOS is a Linux distribution with a custom desktop. The kernel, drivers, and compositor are
reused; the shell, assistant, login, apps, and installer are built here.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Apps: Tauri 2 + React (Settings; Files, Notes, Terminal, Mail, ... next)   │  apps/
│ @newos/ui (window chrome, controls) · @newos/sdk (IPC, settings, assistant)│  packages/
├────────────────────────────────────────────────────────────────────────────┤
│ Shell: AGS/Astal, TypeScript, GTK4 layer-shell                             │  shell/
│ bar · Dynamic Island · Dock · launcher · Control Center · notifications    │
│ app switcher · assistant panel · wallpaper · (greeter, lock screen in M5)  │
├────────────────────────────────────────────────────────────────────────────┤
│ Services (Rust)                                                            │  services/
│ newos-assistantd: models, tools, memory, local API                         │
│ newos-syslib: audio, display, network, Bluetooth, power, input, windows    │
│ newos-appkit: settings file, assistant client and config, keyring (apps)   │
│ (spacesd for Dual Space in M5)                                             │
├────────────────────────────────────────────────────────────────────────────┤
│ Platform: Hyprland · greetd · PipeWire/WirePlumber · NetworkManager ·      │
│ BlueZ · UPower · power-profiles-daemon · fprintd · Flatpak · Ollama        │
├────────────────────────────────────────────────────────────────────────────┤
│ Base: Arch Linux packages, linux-zen, systemd-boot, archiso (M8)           │  distro/
└────────────────────────────────────────────────────────────────────────────┘
```

## Processes in a session

| Process | Started by | Talks to |
|---|---|---|
| Hyprland | greetd (M5/M8), or `scripts/dev-session.sh` | everything on screen |
| Shell (`ags run`, instance `newos`) | Hyprland `exec-once` | Hyprland IPC, D-Bus services, assistantd |
| `newos-assistantd` | systemd user unit (`newos-session.target`) | Anthropic API or Ollama, system tools |
| Ollama | its own systemd service | assistantd |
| Apps (`newos-settings`, ...) | the Dock, Spotlight, `Super+,` | their Rust backend: syslib, appkit, assistantd |

The shell is also the desktop's notification server: it owns
`org.freedesktop.Notifications` through AstalNotifd, so no other notification daemon runs.

## The shell

`shell/app.ts` creates one wallpaper, bar, and Dock per monitor, plus single instances of the
island and each panel. The code is split in two:

- `shell/lib/*.ts` without GTK imports hold the logic: the island's priority queue, the dock
  model, launcher search, the calculator, the SSE parser, Markdown rendering, config parsing,
  and formatting. Vitest tests them in Node (75 tests).
- `shell/lib/*.ts` with GTK imports and `shell/widgets/` bind that logic to Astal services and
  GTK widgets.

### Dynamic Island

Every source pushes an *activity* into `IslandQueue` (`shell/lib/island-queue.ts`). The island
shows the highest-priority activity that hasn't expired:

| Priority | Activity | Lifetime | Size |
|---|---|---|---|
| 100 | Confirmation (Allow/Deny a tool) | until answered | large |
| 90 | Assistant reply | while running, then 6 s | large |
| 80 | Volume, brightness | 1.5 s | expanded |
| 75 | Space / welcome | 2.5 s | expanded |
| 70 | Charging, low battery | 4–8 s | expanded |
| 60 | Notification | 5.5 s (12 s if critical) | expanded |
| 50 | Timer | live | compact, grows on hover |
| 45 | Install progress | live | compact, grows on hover |
| 40 | Now Playing | live (8 s after pause) | compact, grows on hover |

Hovering keeps a transient activity on screen. Sizes animate through CSS transitions on
`min-width`/`min-height`, and content crossfades in a `Gtk.Stack`.

### Commands

Keybindings and scripts drive the shell with `ags request -i newos <command>`. Run
`ags request -i newos help` for the list. It includes launcher, assistant, control-center,
notifications, volume, brightness, theme, dnd, timer, and switcher.

## The assistant

`newos-assistantd` serves HTTP on `$XDG_RUNTIME_DIR/newos/assistant.sock`. The socket is
mode 0600 inside a 0700 directory, so only the logged-in user can reach it. See
[ASSISTANT.md](ASSISTANT.md) for the API.

A chat request goes through these steps:

1. The router (`router.rs`) picks **cloud** (Claude) when a key is configured and the network
   is up, otherwise **local** (Ollama). `mode = "cloud"` or `"local"` pins one.
2. The agent (`agent.rs`) sends the conversation to the model. The user's message starts with
   a `<context>` block holding the time, focused window, battery, and remembered facts. The
   system prompt stays constant, so the prompt cache keeps working.
3. Replies stream back to the shell as Server-Sent Events.
4. When the model calls tools, each input is parsed strictly and checked against the tool's
   schema. Dangerous tools (`run_shell`, `move_to_trash`, `suspend`) wait for Allow in the
   Dynamic Island. Results go back to the model in one message, and the loop continues, at
   most 12 steps.
5. If the cloud fails before producing anything, the same turn retries on the local model.
6. The conversation, facts, and a tool audit log are saved in
   `~/.local/share/newos/assistant.db`.

Claude-specific handling lives in `providers/claude.rs`:

- Thinking blocks are kept verbatim and replayed unchanged.
- Tool inputs stream eagerly, and the daemon validates them because the API no longer does.
- Server-side refusal fallbacks are enabled, so a declined request is re-run on Anthropic's
  recommended fallback model.
- Automatic prompt caching is on.

## Apps

Each app is a Tauri 2 window with a React frontend and a small Rust backend.

- **`@newos/ui`** draws the macOS-style chrome and controls: traffic lights (the window has no
  server-side decorations; Hyprland adds rounding, shadow, and blur), sidebar, toolbar,
  grouped rows, switches, sliders, segmented controls, sheets, popovers. Everything is styled
  with design-token CSS variables, so light/dark and the accent follow the user's settings.
- **`@newos/sdk`** is how the frontend reaches the system. `call("wifi_networks", {rescan})` is
  typed end to end by the `Commands` map in `packages/sdk/src/commands.ts`. The same package
  has the live settings store (`useSettings()`), theming (`useAppTheme()`), the assistant
  client (`assistant.complete("summarize", text)`, streamed `assistant.chat()`), and a mock
  backend so an app's UI runs in a plain browser with sample data.
- **The Rust backend** registers `#[tauri::command]`s that wrap `newos-syslib` (system) and
  `newos-appkit` (settings file with a file watcher, assistant config and keyring, a client
  for assistantd's unix socket, since webviews cannot open one). A Vitest check keeps the SDK's
  command list, the registered handlers, and the mock in step, and IPC tests on Tauri's mock
  runtime call each command with the JSON the frontend sends.

System integration goes through command-line tools (`nmcli`, `bluetoothctl`, `wpctl`,
`hyprctl`, `powerprofilesctl`, `fprintd-list`) behind `CommandRunner`, not D-Bus bindings.
Each parser is unit tested against real output captured on the target laptop, and the tools
are the same ones a user would run to debug. D-Bus (zbus) is used where a tool is not enough:
`spacesd` in milestone 5.

Settings (`apps/settings`, binary `newos-settings`) opens a page with `--page <id>`; ids are
shared with the shell's Spotlight search in `packages/sdk/src/settings-pages.ts`. A second
launch focuses the open window and switches page.

## Files and paths

| Path | Owner | Contents |
|---|---|---|
| `~/.config/newos/shell.json` | shell, Settings | appearance, Dock, bar, island, Focus, Night Shift |
| `~/.config/newos/assistant.toml` | assistantd, Settings | mode, models, privacy, tools |
| `~/.config/newos/hyprland-settings.conf` | Settings | input and monitor choices, applied live with `hyprctl keyword` |
| `~/.config/newos/hyprland-user.conf` | user | Hyprland overrides (sourced last, so they win) |
| Keyring: `service=newos-assistant account=anthropic-api-key` | Settings, assistantd | the Anthropic API key |
| `~/.local/share/newos/assistant.db` | assistantd | conversations, facts, tool audit |
| `~/Notes/*.md` | Notes app, assistant | notes |
| `$XDG_RUNTIME_DIR/newos/assistant.sock` | assistantd | local API |
| `/usr/share/newos/shell/` | package | installed shell and assets (M8) |

Both config files are optional. Invalid or unknown values fall back to defaults in the shell.
The daemon rejects typos with a clear error.

## Design system

`packages/design-tokens/tokens.json` holds colors for light and dark, eight accents, the type
scale, radii, spacing, blur, and motion curves. `pnpm build:tokens` renders it to:

- `gtk-light.css` / `gtk-dark.css`: CSS custom properties the shell loads (GTK 4.16+).
- `tokens.css`: the same variables for web apps, switching on `prefers-color-scheme` or
  `data-theme`.

The shell reloads its stylesheet when the theme or accent changes. It also sets the GNOME
`color-scheme` key so GTK, libadwaita, and portal-aware apps follow along.

## Security model

- The assistant API is reachable only by the user, through the socket's file permissions.
  The optional `--tcp` listener is for development only.
- The API key comes from an environment variable, the Secret Service keyring, or a 0600 file.
  It is never written to the config.
- Tools act as the user and inherit no extra privileges. File tools resolve paths inside the
  home folder and reject `..` and symlink escapes. URLs are limited to http, https, and mailto.
  Window addresses and desktop ids are validated before they reach `hyprctl` or `gtk-launch`.
- Shell commands, the Trash, and sleep always need explicit approval. With no answer within
  2 minutes, the action is denied.
- The systemd unit runs with `NoNewPrivileges`, `ProtectSystem=strict`, and write access only
  to home and the runtime directory.

## Dual Space (M5 design)

One space is one Linux user account, so separation is enforced by the kernel.

- `spacesd` is a root D-Bus service. It checks which account a password or fingerprint
  belongs to, with rate limiting.
- The greeter and lock screen show a single password field.
- A credential for a different space starts that space's session on a second greetd VT. The
  first session stays locked.
- Fingerprint and face logins pass a single-use token to a small PAM module.
