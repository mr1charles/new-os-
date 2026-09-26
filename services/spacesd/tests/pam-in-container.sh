#!/usr/bin/env bash
# End-to-end check of helixos-spacesd with real accounts and real PAM, run as root inside the
# testing container (scripts/live.sh), never on a real system:
#
#   scripts/live.sh shell <<< 'cd $HELIXOS_REPO && CARGO_TARGET_DIR=~/.cache/helixos-target cargo build --release -p helixos-spacesd'
#   scripts/live.sh shell root <<< 'bash $HELIXOS_REPO/services/spacesd/tests/pam-in-container.sh'
set -euo pipefail

[ "${HELIXOS_LIVE:-}" = 1 ] || { echo "run this inside the testing container only" >&2; exit 1; }
[ "$(id -u)" = 0 ] || { echo "run as the container's root" >&2; exit 1; }

BIN="/home/${HELIXOS_LIVE_USER:-a}/.cache/helixos-target/release/helixos-spacesd"
install -Dm644 "$HELIXOS_REPO/distro/configs/pam/helixos-spaces" /etc/pam.d/helixos-spaces
STATE="$(mktemp -d)/spaces.json"

cleanup() {
  for account in space-work space-personal; do userdel --remove "$account" 2>/dev/null || true; done
}
trap cleanup EXIT
cleanup

dbus-run-session -- bash -s "$BIN" "$STATE" <<'INNER'
set -euo pipefail
BIN="$1" STATE="$2"
"$BIN" --session --state "$STATE" &
for _ in $(seq 50); do busctl --user status org.helixos.Spaces1 >/dev/null 2>&1 && break; sleep 0.1; done
call() { busctl --user call org.helixos.Spaces1 /org/helixos/Spaces1 org.helixos.Spaces1 "$@"; }
pass=0 fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; pass=$((pass + 1)); else echo "FAIL $1: expected [$3], got [$2]"; fail=$((fail + 1)); fi; }

call CreateSpace sss "Work" "work-pass-1" "blue" >/dev/null
call CreateSpace sss "Personal" "home-pass-2" "pink" >/dev/null
check "accounts exist" "$(getent passwd space-work space-personal | cut -d: -f1 | tr '\n' ' ')" "space-work space-personal "
check "in the helixos-spaces group" "$(getent group helixos-spaces | cut -d: -f4)" "space-work,space-personal"
check "home folders" "$(stat -c %U /home/space-work)" "space-work"
check "work password" "$(call ResolvePassword s work-pass-1)" 's "space-work"'
check "personal password" "$(call ResolvePassword s home-pass-2)" 's "space-personal"'
check "wrong password" "$(call ResolvePassword s nope 2>&1 | grep -o 'NoMatch\|doesn.t open a space' | head -1)" "doesn’t open a space"
check "duplicate password refused" "$(call CreateSpace sss Copy work-pass-1 green 2>&1 | grep -c 'already opens')" "1"
call SetPassword ss space-work "new-work-pass" >/dev/null
check "changed password" "$(call ResolvePassword s new-work-pass)" 's "space-work"'
check "old password no longer opens it" "$(call ResolvePassword s work-pass-1 2>&1 | grep -c 'open a space')" "1"
call DeleteSpace sb space-personal false
check "deleted account" "$(getent passwd space-personal || echo gone)" "gone"
check "no passwords on disk" "$(grep -c pass "$STATE" || true)" "0"
echo "$pass passed, $fail failed"
kill %1
[ "$fail" = 0 ]
INNER
