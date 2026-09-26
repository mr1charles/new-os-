#!/usr/bin/env bash
# Add "NewOS Preview" to this computer's app menu (no root needed): a launcher in
# ~/.local/bin and an app entry in ~/.local/share/applications. Run it again after moving the
# checkout. Remove with: scripts/install-preview.sh --uninstall
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${HOME}/.local/bin/newos-preview"
DESKTOP="${XDG_DATA_HOME:-$HOME/.local/share}/applications/org.newos.Preview.desktop"
ICON="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps/org.newos.Preview.svg"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$BIN" "$DESKTOP" "$ICON"
  echo "Removed NewOS Preview from the app menu. (The preview itself: scripts/live.sh remove)"
  exit 0
fi

if ! python3 -c 'import gi; gi.require_version("Gtk", "4.0"); gi.require_version("Adw", "1")' 2>/dev/null; then
  echo "NewOS Preview needs python-gobject, gtk4, and libadwaita (sudo pacman -S python-gobject gtk4 libadwaita)" >&2
  exit 1
fi

mkdir -p "$(dirname "$BIN")" "$(dirname "$DESKTOP")" "$(dirname "$ICON")"
cat >"$BIN" <<LAUNCHER
#!/bin/sh
NEWOS_REPO='$REPO' exec python3 '$REPO/preview/newos-preview.py' "\$@"
LAUNCHER
chmod +x "$BIN"
install -m644 "$REPO/preview/newos-preview.svg" "$ICON"
cat >"$DESKTOP" <<ENTRY
[Desktop Entry]
Type=Application
Name=NewOS Preview
Comment=Try the NewOS desktop in a window before installing it
Exec=$BIN
Icon=org.newos.Preview
Terminal=false
Categories=System;Emulator;
Keywords=newos;preview;test;os;
StartupWMClass=org.newos.Preview
ENTRY
command -v update-desktop-database >/dev/null && update-desktop-database -q "$(dirname "$DESKTOP")" || true
echo "NewOS Preview is in your app menu (or run: newos-preview)."
