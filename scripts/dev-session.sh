#!/usr/bin/env bash
# Run the NewOS shell from this checkout.
#
# Started inside a running Wayland desktop, Hyprland opens as a nested window. Started from a
# text console (Ctrl+Alt+F3, log in, run this script), it becomes the whole session.
#
# Needs: hyprland, aylurs-gtk-shell (ags) with the libastal-* libraries, brightnessctl,
# grim, slurp, wl-clipboard, and cargo for the assistant daemon.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}/newos-dev"
mkdir -p "$RUNTIME"

for tool in Hyprland ags; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool is not installed. See docs/DEVELOPING.md." >&2
    exit 1
  fi
done

(cd "$ROOT" && pnpm --filter @newos/design-tokens build >/dev/null)

# Settings writes live input and display changes here; Hyprland refuses to start if a sourced
# file is missing.
SETTINGS_CONF="${XDG_CONFIG_HOME:-$HOME/.config}/newos/hyprland-settings.conf"
mkdir -p "$(dirname "$SETTINGS_CONF")"
touch "$SETTINGS_CONF"
WINDOWS_CONF="$(dirname "$SETTINGS_CONF")/hyprland-windows.conf"
[ -s "$WINDOWS_CONF" ] ||
  printf 'windowrule = float on, match:class .*\nwindowrule = center on, match:float true\n' > "$WINDOWS_CONF"

# Apps built from this checkout (pnpm --filter @newos/settings tauri build --debug --no-bundle)
# are found under their installed names, so Super+, and the shell's Settings buttons open them.
BIN="$RUNTIME/bin"
mkdir -p "$BIN"
if [ -x "$ROOT/target/debug/newos-settings" ]; then
  ln -sf "$ROOT/target/debug/newos-settings" "$BIN/newos-settings"
fi
export PATH="$BIN:$PATH"

CONF="$RUNTIME/hyprland.conf"
cat > "$CONF" <<CONF
monitor = , preferred, auto, 1
source = $ROOT/shell/hypr/newos.conf
source = $WINDOWS_CONF
source = $SETTINGS_CONF
exec-once = dbus-update-activation-environment --systemd WAYLAND_DISPLAY HYPRLAND_INSTANCE_SIGNATURE
exec-once = sh -c 'cd "$ROOT" && cargo run --quiet -p newos-assistantd 2>&1 | tee "$RUNTIME/assistantd.log"'
exec-once = sh -c 'cd "$ROOT/shell" && ags run --gtk 4 app.ts 2>&1 | tee "$RUNTIME/shell.log"'
CONF

echo "NewOS dev session: config $CONF, logs in $RUNTIME"
exec Hyprland -c "$CONF"
