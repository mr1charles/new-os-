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

CONF="$RUNTIME/hyprland.conf"
cat > "$CONF" <<CONF
monitor = , preferred, auto, 1
source = $ROOT/shell/hypr/newos.conf
exec-once = dbus-update-activation-environment --systemd WAYLAND_DISPLAY HYPRLAND_INSTANCE_SIGNATURE
exec-once = sh -c 'cd "$ROOT" && cargo run --quiet -p newos-assistantd 2>&1 | tee "$RUNTIME/assistantd.log"'
exec-once = sh -c 'cd "$ROOT/shell" && ags run --gtk 4 app.ts 2>&1 | tee "$RUNTIME/shell.log"'
CONF

echo "NewOS dev session: config $CONF, logs in $RUNTIME"
exec Hyprland -c "$CONF"
