# Roadmap

Each milestone ends with typecheck, lint, and tests passing in CI, plus a checklist to run on
the laptop or a VM.

| # | Milestone | Status |
|---|---|---|
| M0 | Scaffold: monorepo, design tokens, docs, CI | Done |
| M1 | Desktop shell: bar, Dynamic Island, Dock, launcher, panels | Done |
| M2 | Assistant daemon and assistant UI | Done |
| M3 | Settings app, `@newos/ui` kit, `@newos/sdk` | Done |
| M4 | Files, Notes, Terminal, Calculator | Done |
| M5 | Dual Space login, lock screen, biometrics | In progress |
| M6 | Mail (Gmail, iCloud), Messages, Calendar | Planned |
| M7 | App Store (Flatpak, EXE, APK), Browser, Photos, Music, Clock | Planned |
| M8 | Bootable ISO, installer, HP tweaks, ISO built in CI | Planned |
| M9 | Gestures, Mission Control, Spotlight-grade search, updates, voice | Planned |

## M0 — Scaffold (done)

- [x] pnpm workspace, strict TypeScript, ESLint, Prettier, Vitest
- [x] Cargo workspace with rustfmt and clippy
- [x] `@newos/design-tokens`: light/dark colors, 8 accents, type, radii, blur, motion →
      GTK4 CSS and web CSS
- [x] CI for both toolchains
- [x] Docs

## M1 — Desktop shell (done)

- [x] Menu bar: OS menu (About, Settings, Sleep, Restart, Shut Down, Lock, Log Out), active
      app, tray, battery, Bluetooth, Wi-Fi, volume, Control Center, assistant, clock
- [x] Dynamic Island with a priority queue: notifications, media (live), volume and
      brightness, charging and low battery, timers (live), installs (live), assistant,
      confirmations, welcome
- [x] Dock: pinned and running apps, magnification, launch bounce, running dots, context
      menu (windows, Keep in Dock, Quit), Launchpad
- [x] Launcher: Spotlight search (apps, Settings pages, calculator, assistant, web) and
      Launchpad grid
- [x] Control Center: Wi-Fi and Bluetooth (with network and device lists), Airplane, Focus,
      Dark Mode, Night Shift, brightness, volume, Now Playing, battery and power modes
- [x] Notification Center with calendar, timers, and history
- [x] App switcher (Super+Tab), light and dark wallpapers, original icons
- [x] Hyprland config: floating windows, blur, animations, gestures, macOS-style shortcuts
- [ ] Verified on the laptop (needs the ISO or an Arch install)

## M2 — Assistant (done)

- [x] `newos-assistantd`: local HTTP API on a user-only unix socket
- [x] Claude provider: streaming, tool use, adaptive thinking, refusal fallbacks, prompt caching
- [x] Ollama provider: streaming, tool calls, embeddings
- [x] Automatic routing between cloud and on-device, with fallback when the cloud is unreachable
- [x] 29 tools: system settings, apps and windows, files, notes, timers, memory, shell
- [x] Approval in the Dynamic Island for shell commands, Trash, and sleep
- [x] Conversation history, remembered facts, tool audit log (SQLite)
- [x] One-shot tasks for apps: summarize, rewrite, classify, reply, explain, command, extract, title
- [x] Shell: assistant panel (Super+Space), island states, launcher hand-off
- [ ] Voice input and output (M9)

## Testing mode (done)

- [x] `scripts/live.sh`: the whole desktop in a rootless Arch container on the laptop, in a
      window or full screen, with the real Wi-Fi, Bluetooth, sound, GPU, and fingerprint reader
- [x] First run found and fixed: Hyprland 0.56 rule syntax, the Mission Control binding without
      its plugin, and a Control Center crash on start

## M3 — Settings, UI kit, SDK (done)

- [x] `@newos/ui`: window chrome with traffic lights, sidebar, toolbar, grouped lists, sheets,
      popovers, switches, sliders, segmented controls, pop-up menus, search field
- [x] `@newos/sdk`: typed calls to the app backend, live settings store shared with the shell,
      assistant client (status, one-shot tasks, streamed chat, embeddings), theming, React
      hooks, and a mock backend for browser development
- [x] Settings app: Wi-Fi, Bluetooth, Network, Notifications, Focus, Sound, Appearance,
      Wallpaper, Desktop & Dock, Displays (with a revert timer), Battery, Assistant (API key
      into the keyring, cloud and on-device models), Privacy & Security, Users & Spaces
      (account and fingerprints; spaces arrive in M5), Keyboard, Trackpad, Software Update,
      About
- [x] `services/syslib`: Wi-Fi scan and join, Bluetooth pairing, audio devices, monitors,
      power profiles, battery health, Hyprland input options, accounts, fingerprints, updates,
      hardware summary; parsers tested against output from the HP laptop
- [x] `services/appkit`: shared app backend (settings file and watcher, assistant config and
      keyring, assistantd client over the unix socket)
- [x] Settings persists input and display choices in `~/.config/newos/hyprland-settings.conf`
- [ ] Verified as a native window on the laptop (needs `webkit2gtk-4.1`; see DEVELOPING.md)

Changed from the plan: system integration uses the standard command-line tools behind a
tested `CommandRunner` instead of D-Bus bindings. D-Bus comes in with `spacesd` (M5).

## M4 — Core apps (done)

- [x] Shared app backend in `newos-appkit` (`tauri_app`): settings and assistant commands, the
      settings watcher, and the NewOS window; `scripts/new-app.py` scaffolds a new app
- [x] **Files**: places, drives (mount and eject through UDisks), list and icon views, sorting,
      multi-select, inline rename, copy/cut/paste with Finder-style names, context menu, the
      Trash (put back, empty), Quick Look for images, PDFs, and text, and search in plain
      language ("the pdf about taxes from March") locally or through the assistant; "Summarize"
      for documents and PDFs
- [x] **Notes**: Markdown in `~/Notes` shared with the assistant, folders, pins, clickable
      checklists, search, live reload when the assistant writes a note; Summarize, Rewrite in a
      tone, Continue Writing, and Ask My Notes (answers grounded in your notes, with sources)
- [x] **Terminal**: your shell in a real PTY, tabs that open in the same folder, themes that
      follow appearance and accent; Ctrl+Space turns English into a command (with a warning for
      destructive ones) and "Explain Output" explains the last error
- [x] **Calculator**: basic, scientific (degrees or radians), unit conversion, history, and
      everyday questions ("15% tip on 84", "5 km in miles"); the assistant only turns words
      into an expression, the math happens locally
- [ ] Column view and drag and drop in Files; embedding-based "ask my notes" (keyword retrieval
      for now)

## M5 — Dual Space (in progress)

- [x] `newos-spacesd` (system D-Bus `org.newos.Spaces1`): which space a password opens, through
      PAM; rate limited; only the greeter and spaces may ask; changes need polkit; a password
      that already opens another space is refused. Tested with mocks, on a real D-Bus, and with
      real accounts and PAM inside the testing container. Design: [DUAL-SPACE.md](DUAL-SPACE.md)
- [x] Login screen (`shell/greeter.ts`) for greetd: one password field, no user list, then
      greetd logs in the space it opens; configs in `distro/configs/greetd`
- [x] Lock screen on ext-session-lock: your password unlocks; another space's password is
      recognized
- [x] Settings → Users & Spaces: add, rename, change password, make default, delete
- [x] Testing mode runs a demo spacesd ("work-demo", "home-demo") and a lock password ("newos")
- [ ] Switching to another running space from the lock screen (logind session activation)
- [ ] Starting a space that is not running from the lock screen (second greeter on another VT)
- [ ] Fingerprint login to a space (single-use token PAM module); the ELAN reader works
- [ ] Per-space wallpaper and accent on the login screen

## M6 — Communication

Mail over IMAP/SMTP (Gmail and iCloud with app passwords; Gmail OAuth later) with priority
inbox, summaries, and suggested replies. Messages over Matrix, plus SMS through a virtual
number (Twilio or Telnyx) so texting works without a phone. Calendar with CalDAV and
natural-language events.

## M7 — App Store and media

One search over Flathub, Windows apps through Bottles (Wine), and Android apps through
Waydroid. Installs show progress in the island. Browser, Photos, Music, Clock.

## M8 — Bootable ISO

archiso profile with linux-zen, Intel microcode and graphics, PipeWire, NetworkManager, BlueZ,
greetd, Hyprland, Astal, Flatpak, Waydroid, Wine, fprintd, Howdy, and Ollama. Tauri installer:
hardware check, disk (whole disk or next to Windows), spaces, Wi-Fi, assistant, biometrics.
GitHub Actions builds the ISO.

## M9 — Polish

Pinch and four-finger gestures, Mission Control, embedding-based search, screenshot HUD,
system updates in the App Store, voice (whisper.cpp in, piper out), accessibility, and
encrypted homes per space.
