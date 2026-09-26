# Hardware: the HP laptop

NewOS targets the owner's **HP Laptop 14-dq2xxx**, product number (SKU) **50V33UA#ABA**. This
is the 14" non-touch model without a pen, not the Pavilion x360. Confirmed on 2026-09-26 by
running the checks below on the laptop itself (CachyOS, kernel 7.2, Hyprland 0.56):

| Part | This laptop | Linux driver | Result |
|---|---|---|---|
| CPU | Intel Core i3-1125G4 (Tiger Lake, 4 cores / 8 threads) | built in, `intel-ucode` | works |
| Memory | 16 GB | | works |
| Graphics | Intel UHD Graphics G4 (Tiger Lake-LP GT2, `8086:9a78`) | `i915` | works; early KMS in the ISO |
| Screen | 14" 1920×1080 60 Hz, Chimei Innolux 0x14D4, `eDP-1`, no touch | | works at 100% scale |
| Storage | 256 GB NVMe SSD (WD PC SN530) | `nvme` | works |
| Wi-Fi | Realtek RTL8822CE (`10ec:c822`) | `rtw88_8822ce` | works |
| Bluetooth | Realtek (`0bda:b00c`, same card) | `btusb` | works |
| Audio | Intel HD Audio, SOF (`sof-hda-dsp`): speakers, 2 microphones, HDMI | `sof-audio-pci-intel-tgl`, `sof-firmware` | works |
| Touchpad | Synaptics I2C HID (`06cb:cd50`) | `i2c_hid_acpi` | works, gestures through Hyprland |
| Fingerprint | **ELAN Match-on-Chip 2** (`04f3:0c00`) | `libfprint` with the elanmoc2 driver | **works**: enrolled and verified with fprintd |
| Webcam | HP TrueVision HD (`30c9:0013`), no IR | `uvcvideo` | works; face unlock is convenience only |
| Card reader | Alcor Micro (`058f:6366`) | `usb-storage` | works |
| Battery | `BAT0`, 120 cycles, 68% of design capacity | `battery` | works; health shown in Settings |
| Power modes | power-saver, balanced, performance | `power-profiles-daemon` (`intel_pstate`) | works |
| Firmware | UEFI F.33, Secure Boot | systemd-boot | turn Secure Boot off for the first install |

### Fingerprint reader

The ELAN `04f3:0c00` reader is supported by the `elanmoc2` driver, which is not in upstream
libfprint yet. It is packaged in the AUR as `libfprint-elanmoc2-working-git`, and that
package is what makes it work on this laptop today. The NewOS ISO (milestone 8) must ship that
libfprint build instead of Arch's `libfprint`. With it, Dual Space can use fingerprints to pick
a space (milestone 5.1).

### Battery

The battery holds 68% of its design capacity after 120 cycles. Expect about two-thirds of the
original runtime. Settings → Battery shows the live figure.

## Checklist for the first boot (live USB)

```bash
lspci -nn | grep -Ei 'vga|network|audio'
lsusb                                   # fingerprint reader: look for Synaptics (06cb) or Goodix (27c6)
ip link                                 # wlan0 present?
fprintd-list "$USER"                    # "No devices available" means unsupported
cat /sys/class/power_supply/BAT*/capacity
brightnessctl info
wpctl status                            # speakers and microphone listed?
libinput list-devices | grep -A1 -i touch
```

Record the output here. The installer's hardware page (milestone 8) runs the same checks.

## Known workarounds

- **Realtek Wi-Fi drops:** `options rtw88_core disable_lps_deep=y` in
  `/etc/modprobe.d/rtw88.conf`. The ISO ships this when a Realtek card is detected.
- **Screen flicker on some Iris Xe panels:** `i915.enable_psr=0` on the kernel command line.
- **Fingerprint reader not supported by libfprint:** Dual Space still works with passwords.
  Fingerprint login stays hidden in Settings.
- **Face unlock:** the webcam has no IR sensor, so Howdy can be fooled by a photo. Settings
  labels it "convenience, not security" and never uses it for `sudo`.
