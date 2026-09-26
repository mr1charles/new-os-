#!/usr/bin/env bash
# HelixOS testing mode: the whole desktop in a rootless Arch Linux container on this machine.
#
#   scripts/live.sh create    build the container (first time: ~2 GB download, 15-30 min)
#   scripts/live.sh run       start HelixOS
#   scripts/live.sh update    rebuild HelixOS from this checkout after you pull or edit
#   scripts/live.sh shell     a shell inside the container (add `root` for a root shell)
#   scripts/live.sh exec CMD  run a command in the running HelixOS session (hyprctl, ags ...)
#   scripts/live.sh remove    delete the container
#
# `run` inside a desktop opens HelixOS in a window; in that window Alt replaces Super for the
# shortcuts (Alt+Space assistant, Alt+A search), because the host keeps Super for itself.
# `run` from a text console (Ctrl+Alt+F3, log in) takes over the whole screen like the real
# OS, with the real Super key.
#
# Super+L (Alt+L in a window) locks the screen; the password is "helixos". Dual Space runs in demo
# mode: "work-demo" and "home-demo" are the passwords of two pretend spaces.
#
# No root needed: the container uses user namespaces (the ranges in /etc/subuid and
# /etc/subgid). It shares the host's network, GPU, sound (PipeWire), and system services
# (NetworkManager, BlueZ, UPower, fprintd, logind), so Wi-Fi, Bluetooth, volume, and the
# fingerprint reader in HelixOS are the real ones. It has its own home folder, so HelixOS
# settings never touch the host desktop's.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF="$REPO/scripts/live.sh"
BASE="${HELIXOS_LIVE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/helixos-live}"
# HelixOS was called NewOS: keep a preview made under the old name.
OLD_BASE="${XDG_DATA_HOME:-$HOME/.local/share}/newos-live"
if [ -z "${HELIXOS_LIVE_DIR:-}" ] && [ -d "$OLD_BASE" ] && [ ! -e "$BASE" ]; then
  mv "$OLD_BASE" "$BASE"
fi
ROOT="$BASE/root"
LOGS="${XDG_RUNTIME_DIR:-/tmp}/helixos-live"
# Fixed before entering the namespace, where `id` would report the container's root.
HOST_UID="${HELIXOS_LIVE_UID:-$(id -u)}"
HOST_GID="${HELIXOS_LIVE_GID:-$(id -g)}"
USER_NAME="${HELIXOS_LIVE_USER:-$(id -un)}"
export HELIXOS_LIVE_UID="$HOST_UID" HELIXOS_LIVE_GID="$HOST_GID" HELIXOS_LIVE_USER="$USER_NAME"
MIRROR="${HELIXOS_LIVE_MIRROR:-https://fastly.mirror.pkgbuild.com}"

# Packages from the Arch repositories. AGS and the Astal libraries come from the AUR.
PACKAGES=(
  base-devel git sudo which
  nodejs rust
  hyprland hypridle xdg-desktop-portal-hyprland mesa vulkan-intel
  gtk3 gtk4 gtk4-layer-shell libadwaita librsvg gobject-introspection webkit2gtk-4.1
  wireplumber networkmanager bluez-utils upower power-profiles-daemon python-gobject
  brightnessctl fprintd pacman-contrib poppler udisks2 clang
  libsecret gnome-keyring libnotify libcanberra playerctl
  grim slurp wl-clipboard xdg-utils
  inter-font ttf-jetbrains-mono noto-fonts noto-fonts-emoji adwaita-icon-theme
  kitty firefox xdotool wtype
)
AUR_PACKAGES=(aylurs-gtk-shell-git libastal-meta)

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

subid_range() { # file -> "start count" for this user
  awk -F: -v u="$USER_NAME" -v id="$HOST_UID" '$1 == u || $1 == id { print $2, $3; exit }' "$1"
}

# Enter the user namespace: container uids 0-999 and 1001-65535 come from the subordinate
# range, and container uid 1000 is you, so files you create inside are yours outside.
in_userns() {
  local uid_start uid_count gid_start gid_count
  read -r uid_start uid_count < <(subid_range /etc/subuid) || true
  read -r gid_start gid_count < <(subid_range /etc/subgid) || true
  if [ -z "${uid_start:-}" ] || [ "${uid_count:-0}" -lt 65536 ] || [ -z "${gid_start:-}" ] || [ "${gid_count:-0}" -lt 65536 ]; then
    die "no subordinate uid/gid range for $USER_NAME in /etc/subuid and /etc/subgid (need 65536; run: sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $USER_NAME)"
  fi
  if [ "$HOST_UID" != 1000 ] || [ "$HOST_GID" != 1000 ]; then
    die "testing mode expects uid and gid 1000"
  fi
  unshare \
    --map-users="0:$uid_start:1000" --map-users="1000:$HOST_UID:1" --map-users="1001:$((uid_start + 1001)):64535" \
    --map-groups="0:$gid_start:1000" --map-groups="1000:$HOST_GID:1" --map-groups="1001:$((gid_start + 1001)):64535" \
    --setuid=0 --setgid=0 --mount --pid --fork --kill-child --propagation=slave \
    -- "$@"
}

# Runs as container root inside the namespaces: mount the container's view, then chroot.
# $1: "root" or "user"; the rest is the command.
inner() {
  local as="$1"
  shift
  local runtime="/run/user/1000"
  mount --bind "$ROOT" "$ROOT"
  mount -t proc proc "$ROOT/proc"
  mount -t tmpfs -o mode=1777 tmpfs "$ROOT/tmp"
  mkdir -p "$ROOT/run/dbus" "$ROOT/run/udev" "$ROOT/run/systemd" "$ROOT$runtime" "$ROOT$REPO"
  mount -t tmpfs tmpfs "$ROOT/run/user"
  mkdir -p "$ROOT$runtime" && chown 1000:1000 "$ROOT$runtime" && chmod 700 "$ROOT$runtime"
  if [ "$as" = root ]; then
    # Package installs get a private /dev with only the basic nodes and no host services, so
    # install hooks cannot reach the host's devices, systemd, or udev.
    mount -t tmpfs -o mode=755 tmpfs "$ROOT/dev"
    for node in null zero full random urandom tty; do
      touch "$ROOT/dev/$node"
      mount --bind "/dev/$node" "$ROOT/dev/$node"
    done
    mkdir -p "$ROOT/dev/shm" "$ROOT/dev/pts"
    mount -t tmpfs -o mode=1777 tmpfs "$ROOT/dev/shm"
    ln -s /proc/self/fd "$ROOT/dev/fd"
  else
    # The desktop session: the real GPU, input, and system services, as your own user.
    mount --rbind /sys "$ROOT/sys"
    mount --rbind /dev "$ROOT/dev"
    [ -d /run/dbus ] && mount --bind /run/dbus "$ROOT/run/dbus"
    [ -d /run/udev ] && mount --rbind /run/udev "$ROOT/run/udev"
    [ -d /run/systemd ] && mount --rbind /run/systemd "$ROOT/run/systemd"
  fi
  cp -L /etc/resolv.conf "$ROOT/etc/resolv.conf" 2>/dev/null || true
  mount --bind "$REPO" "$ROOT$REPO"
  # The host's Rust crate cache, so builds inside do not download everything again.
  if [ -d "$HOME/.cargo/registry" ]; then
    mkdir -p "$ROOT/home/$USER_NAME/.cargo/registry"
    mount --bind "$HOME/.cargo/registry" "$ROOT/home/$USER_NAME/.cargo/registry"
  fi
  # Only the sockets HelixOS needs from the host session: the display and sound. The session
  # D-Bus stays private so the HelixOS shell can be the notification server without taking
  # notifications from the host desktop.
  local host_runtime="${HOST_RUNTIME:-}"
  if [ -n "$host_runtime" ]; then
    for sock in "${HOST_WAYLAND:-}" pipewire-0 pipewire-0-manager; do
      if [ -z "$sock" ] || [ ! -S "$host_runtime/$sock" ]; then continue; fi
      touch "$ROOT$runtime/$sock"
      mount --bind "$host_runtime/$sock" "$ROOT$runtime/$sock"
    done
  fi

  local env=(
    "HOME=/home/$USER_NAME" "USER=$USER_NAME" "LOGNAME=$USER_NAME" "SHELL=/bin/bash"
    "PATH=/usr/local/bin:/usr/bin" "LANG=${LANG:-C.UTF-8}" "TERM=${TERM:-xterm-256color}"
    "XDG_RUNTIME_DIR=$runtime" "HELIXOS_REPO=$REPO" "HELIXOS_LIVE=1" "HELIXOS_LIVE_ROOT_HINT=$ROOT"
  )
  [ -n "${HOST_WAYLAND:-}" ] && env+=("WAYLAND_DISPLAY=$HOST_WAYLAND")
  [ -n "${XDG_SEAT:-}" ] && env+=("XDG_SEAT=$XDG_SEAT")
  [ -n "${XDG_SESSION_ID:-}" ] && env+=("XDG_SESSION_ID=$XDG_SESSION_ID")
  [ -n "${XDG_VTNR:-}" ] && env+=("XDG_VTNR=$XDG_VTNR")
  if [ "$as" = root ]; then
    exec chroot "$ROOT" /usr/bin/env -i "${env[@]}" HOME=/root USER=root "$@"
  fi
  # Become uid 1000 (you) but keep the host's supplementary groups (video, render, input),
  # which the GPU and input devices check.
  exec chroot "$ROOT" /usr/bin/setpriv --reuid=1000 --regid=1000 --keep-groups \
    /usr/bin/env -i "${env[@]}" "$@"
}

enter() { # root|user command...
  [ -x "$ROOT/usr/bin/bash" ] || die "no container yet. Run: scripts/live.sh create"
  export HOST_RUNTIME="${XDG_RUNTIME_DIR:-}" HOST_WAYLAND="${WAYLAND_DISPLAY:-}"
  in_userns /usr/bin/env bash "$SELF" __inner "$@"
}

create() {
  if ! command -v unshare >/dev/null || ! command -v newuidmap >/dev/null; then
    die "needs unshare and newuidmap (util-linux, shadow)"
  fi
  mkdir -p "$BASE"
  if [ ! -x "$ROOT/usr/bin/bash" ]; then
    if [ ! -f "$BASE/bootstrap.tar.zst" ]; then
      say "Downloading the Arch Linux base system"
      curl -fL --progress-bar -o "$BASE/bootstrap.tar.zst.part" "$MIRROR/iso/latest/archlinux-bootstrap-x86_64.tar.zst"
      mv "$BASE/bootstrap.tar.zst.part" "$BASE/bootstrap.tar.zst"
    fi
    say "Unpacking"
    in_userns rm -rf "$BASE/root.x86_64"
    in_userns tar --zstd -xpf "$BASE/bootstrap.tar.zst" -C "$BASE" --numeric-owner
    in_userns mv "$BASE/root.x86_64" "$ROOT"
    rm -f "$BASE/bootstrap.tar.zst"
  fi

  say "Configuring the container"
  in_userns /usr/bin/env bash -s -- "$ROOT" "$MIRROR" "$USER_NAME" <<'SETUP'
set -euo pipefail
ROOT="$1" MIRROR="$2" NAME="$3"
echo "Server = $MIRROR/\$repo/os/\$arch" > "$ROOT/etc/pacman.d/mirrorlist"
# pacman's download sandbox needs privileges a user namespace does not have.
grep -q '^DisableSandbox' "$ROOT/etc/pacman.conf" || sed -i 's/^\[options\]/[options]\nDisableSandbox/' "$ROOT/etc/pacman.conf"
sed -i 's/^#ParallelDownloads.*/ParallelDownloads = 8/' "$ROOT/etc/pacman.conf"
grep -q "^$NAME:" "$ROOT/etc/passwd" || {
  echo "$NAME:x:1000:1000:$NAME:/home/$NAME:/bin/bash" >> "$ROOT/etc/passwd"
  echo "$NAME:x:1000:" >> "$ROOT/etc/group"
  echo "$NAME:!*:20000::::::" >> "$ROOT/etc/shadow"
}
# A known password for the container's user, so its lock screen can be unlocked: "helixos".
# It exists only inside the container.
chroot "$ROOT" /usr/bin/sh -c "echo '$NAME:helixos' | chpasswd" 2>/dev/null || true
mkdir -p "$ROOT/home/$NAME" && chown 1000:1000 "$ROOT/home/$NAME"
mkdir -p -m 750 "$ROOT/etc/sudoers.d"
echo "$NAME ALL=(ALL) NOPASSWD: ALL" > "$ROOT/etc/sudoers.d/helixos-live"
chmod 440 "$ROOT/etc/sudoers.d/helixos-live"
echo "en_US.UTF-8 UTF-8" > "$ROOT/etc/locale.gen"
echo "helixos-live" > "$ROOT/etc/hostname"
SETUP

  say "Installing packages (the big download)"
  enter root bash -c "
    set -e
    [ -d /etc/pacman.d/gnupg ] || { pacman-key --init && pacman-key --populate archlinux; }
    pacman -Syu --noconfirm --needed ${PACKAGES[*]}
    locale-gen >/dev/null
  "

  say "Building AGS and the Astal libraries from the AUR"
  enter user bash -c "
    set -e
    if ! command -v yay >/dev/null; then
      rm -rf /tmp/yay-bin && git clone -q https://aur.archlinux.org/yay-bin.git /tmp/yay-bin
      (cd /tmp/yay-bin && makepkg -si --noconfirm)
    fi
    yay -S --noconfirm --needed --answerclean None --answerdiff None ${AUR_PACKAGES[*]}
  "

  update
  say "Ready. Start HelixOS with: scripts/live.sh run"
}

# Build this checkout inside the container and install it there.
update() {
  say "Building HelixOS from $REPO"
  # shellcheck disable=SC2016 # expanded inside the container, not here
  enter user bash -c '
    set -e
    cd "$HELIXOS_REPO"
    export CARGO_TARGET_DIR="$HOME/.cache/helixos-target"
    # Renamed from NewOS: keep the build cache.
    sudo rm -f /usr/local/bin/newos-* /usr/local/share/applications/newos-*.desktop \
      /usr/local/share/icons/hicolor/scalable/apps/newos-*.svg /etc/pam.d/newos-spaces
    [ -d "$HOME/.cache/newos-target" ] && [ ! -e "$CARGO_TARGET_DIR" ] && mv "$HOME/.cache/newos-target" "$CARGO_TARGET_DIR"
    [ -d node_modules ] || { echo "error: run pnpm install on the host first" >&2; exit 1; }
    # Tools added after the container was created.
    sudo pacman -S --needed --noconfirm poppler udisks2 clang wtype flatpak >/dev/null 2>&1 || true
    # The lock screen needs a password to unlock: "helixos" (this container only).
    echo "$USER:helixos" | sudo chpasswd
    cargo build --release -p helixos-spacesd
    sudo install -Dm755 "$CARGO_TARGET_DIR/release/helixos-spacesd" /usr/local/bin/helixos-spacesd
    sudo install -Dm644 distro/configs/pam/helixos-spaces /etc/pam.d/helixos-spaces
    node packages/design-tokens/src/build.mjs >/dev/null
    cargo build --release -p helixos-assistantd
    sudo install -Dm755 "$CARGO_TARGET_DIR/release/helixos-assistantd" /usr/local/bin/helixos-assistantd
    cargo build --release -p helixos-opener
    sudo install -Dm755 "$CARGO_TARGET_DIR/release/helixos-open" /usr/local/bin/helixos-open
    sudo install -Dm644 distro/applications/helixos-open.desktop /usr/local/share/applications/helixos-open.desktop
    sudo install -Dm644 distro/configs/xdg/mimeapps.list /etc/xdg/mimeapps.list
    sudo update-desktop-database -q /usr/local/share/applications 2>/dev/null || true
    for app in settings calculator notes terminal files; do
      echo "Building $app"
      (cd "apps/$app" && node_modules/.bin/vite build --logLevel warn)
      cargo build --release -p "helixos-$app" --features tauri/custom-protocol
      sudo install -Dm755 "$CARGO_TARGET_DIR/release/helixos-$app" "/usr/local/bin/helixos-$app"
      sudo install -Dm644 "apps/$app/helixos-$app.desktop" "/usr/local/share/applications/helixos-$app.desktop"
      sudo install -Dm644 "apps/$app/src-tauri/icons/icon.svg" "/usr/local/share/icons/hicolor/scalable/apps/helixos-$app.svg"
    done
    sudo gtk-update-icon-cache -q -t /usr/local/share/icons/hicolor 2>/dev/null || true
  '
}

# The session inside the container (runs as you, after chroot).
session() {
  local conf_dir="$XDG_RUNTIME_DIR/helixos-live" logs="$HOME/.local/state/helixos-live"
  # Renamed from NewOS: keep the preview's settings.
  if [ -d "$HOME/.config/newos" ] && [ ! -e "$HOME/.config/helixos" ]; then
    mv "$HOME/.config/newos" "$HOME/.config/helixos"
  fi
  mkdir -p "$conf_dir" "$logs" "$HOME/.config/helixos"
  touch "$HOME/.config/helixos/hyprland-settings.conf" "$HOME/.config/helixos/hyprland-user.conf"
  # Window layout rules; the shell rewrites this from Settings. Floating windows until then.
  [ -s "$HOME/.config/helixos/hyprland-windows.conf" ] ||
    printf 'windowrule = float on, match:class .*\nwindowrule = center on, match:float true\n' \
      > "$HOME/.config/helixos/hyprland-windows.conf"
  # Use a model the host's Ollama already has, unless the tester chose one.
  if [ ! -f "$HOME/.config/helixos/assistant.toml" ]; then
    local installed model="" want
    installed="$(curl -fsS http://127.0.0.1:11434/api/tags 2>/dev/null |
      grep -oE '"name":"[^"]+"' | sed 's/"name":"//; s/"$//' || true)"
    # Small instruct models first: they answer quickly on this CPU.
    for want in 'qwen2\.5:3b' 'llama3\.2:3b' 'qwen3:4b' 'qwen2\.5' '.'; do
      model="$(grep -m1 -E "^$want" <<<"$installed" || true)"
      [ -n "$model" ] && break
    done
    printf '[local]\nmodel = "%s"\n' "${model:-qwen2.5:3b}" > "$HOME/.config/helixos/assistant.toml"
  fi

  local helixos_conf="$HELIXOS_REPO/shell/hypr/helixos.conf"
  if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    # Nested in a window: the host compositor keeps Super, so HelixOS shortcuts use Alt.
    # shellcheck disable=SC2016 # $mod is Hyprland's variable, not the shell's
    sed 's/^\$mod = SUPER/$mod = ALT/' "$helixos_conf" > "$conf_dir/helixos.conf"
    helixos_conf="$conf_dir/helixos.conf"
  fi
  cat > "$conf_dir/hyprland.conf" <<CONF
monitor = , preferred, auto, 1
source = $helixos_conf
source = $HOME/.config/helixos/hyprland-windows.conf
source = $HOME/.config/helixos/hyprland-settings.conf
env = XCURSOR_SIZE, 24
# Dual Space in testing mode: a demo spacesd on the session bus with two mock spaces, "Work"
# (password work-demo) and "Personal" (home-demo). No real accounts are created.
env = HELIXOS_SPACES_BUS, session
exec-once = sh -c 'helixos-spacesd --session --demo > "$logs/spacesd.log" 2>&1'
exec-once = gnome-keyring-daemon --start --components=secrets
exec-once = sh -c 'helixos-assistantd > "$logs/assistantd.log" 2>&1'
exec-once = sh -c 'cd "$HELIXOS_REPO/shell" && XDG_DATA_DIRS="\$HOME/.local/share/flatpak/exports/share:/var/lib/flatpak/exports/share:/usr/local/share:/usr/share" exec ags run --gtk 4 app.ts > "$logs/shell.log" 2>&1'
source = $HOME/.config/helixos/hyprland-user.conf
CONF
  echo "HelixOS testing mode. Logs: ${HELIXOS_LIVE_ROOT_HINT:-}$logs"
  exec dbus-run-session -- Hyprland -c "$conf_dir/hyprland.conf" > "$logs/hyprland.log" 2>&1
}

# Join the running session's namespaces (as you, inside the container) and run a command.
exec_in_session() {
  local pid="" candidate
  # The container's Hyprland: the one whose root directory is the container.
  for candidate in $(pgrep -u "$HOST_UID" -x Hyprland); do
    if [ "$(readlink "/proc/$candidate/root")" = "$ROOT" ]; then
      pid="$candidate"
      break
    fi
  done
  [ -n "$pid" ] || die "HelixOS is not running. Start it with: scripts/live.sh run"
  local signature bus display runtime="/proc/$pid/root/run/user/1000"
  signature="$(find "$runtime/hypr" -mindepth 1 -maxdepth 1 -printf '%f\n' 2>/dev/null | head -1)"
  # The session's own D-Bus (dbus-run-session) and Wayland socket, not the host's.
  bus="$(tr '\0' '\n' <"/proc/$pid/environ" | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p')"
  display="$(find "$runtime" -maxdepth 1 -name 'wayland-*' ! -name '*.lock' -printf '%f\n' | grep -vx "${WAYLAND_DISPLAY:-none}" | head -1)"
  nsenter --target "$pid" --user --mount --pid --root --wd=/ --setuid 1000 --setgid 1000 --preserve-credentials \
    /usr/bin/env -i -C "/home/$USER_NAME" PATH=/usr/local/bin:/usr/bin HOME="/home/$USER_NAME" XDG_RUNTIME_DIR=/run/user/1000 \
    HYPRLAND_INSTANCE_SIGNATURE="$signature" WAYLAND_DISPLAY="${display:-wayland-1}" DBUS_SESSION_BUS_ADDRESS="$bus" \
    HELIXOS_REPO="$REPO" "$@"
}

remove() {
  [ -d "$BASE" ] || {
    echo "Nothing to remove."
    return
  }
  read -r -p "Delete the HelixOS testing container in $BASE? [y/N] " answer
  [ "$answer" = y ] || [ "$answer" = Y ] || return
  # Files owned by container users can only be deleted from inside the namespace.
  in_userns rm -rf "$BASE"
  echo "Removed."
}

case "${1:-}" in
  create) create ;;
  update) update ;;
  run)
    mkdir -p "$LOGS"
    enter user bash "$SELF" __session
    ;;
  shell)
    if [ "${2:-}" = root ]; then enter root bash -l; else enter user bash -l; fi
    ;;
  exec)
    shift
    exec_in_session "$@"
    ;;
  remove) remove ;;
  __inner)
    shift
    inner "$@"
    ;;
  __session) session ;;
  *)
    sed -n '2,17p' "$SELF" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
