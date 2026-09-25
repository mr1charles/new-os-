#!/usr/bin/env bash
# Boot a NewOS ISO in QEMU with UEFI firmware (the ISO build arrives in milestone 8).
#
#   scripts/dev-vm.sh [path/to/newos.iso]
#
# Needs qemu-full (or qemu-system-x86) and edk2-ovmf. Creates a 32 GB disk image on first run
# so the installer has somewhere to install.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ISO="${1:-$ROOT/out/newos.iso}"
DISK="$ROOT/out/newos-vm.qcow2"
VARS="$ROOT/out/OVMF_VARS.fd"

if [[ ! -f "$ISO" ]]; then
  echo "error: $ISO not found. Build it with scripts/build-iso.sh (milestone 8)." >&2
  exit 1
fi

OVMF_CODE=""
for candidate in /usr/share/edk2/x64/OVMF_CODE.4m.fd /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/OVMF/OVMF_CODE.fd; do
  [[ -f "$candidate" ]] && OVMF_CODE="$candidate" && break
done
if [[ -z "$OVMF_CODE" ]]; then
  echo "error: OVMF firmware not found; install edk2-ovmf (Arch) or ovmf (Debian/Ubuntu)." >&2
  exit 1
fi

mkdir -p "$ROOT/out"
[[ -f "$DISK" ]] || qemu-img create -f qcow2 "$DISK" 32G
[[ -f "$VARS" ]] || cp "${OVMF_CODE/CODE/VARS}" "$VARS"

exec qemu-system-x86_64 \
  -enable-kvm -machine q35 -cpu host -smp 4 -m 4096 \
  -drive if=pflash,format=raw,readonly=on,file="$OVMF_CODE" \
  -drive if=pflash,format=raw,file="$VARS" \
  -drive file="$DISK",if=virtio \
  -cdrom "$ISO" -boot order=d \
  -device virtio-vga-gl -display gtk,gl=on \
  -device intel-hda -device hda-duplex \
  -nic user,model=virtio-net-pci
