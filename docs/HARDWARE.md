# Hardware: the HP laptop

NewOS targets the owner's HP laptop, reported as model **"dq250cl"**. That string didn't match
a published HP model exactly. The closest families are:

| Family | Screen | Fingerprint | Notes |
|---|---|---|---|
| HP 14-dq2xxx | 14" 1080p, non-touch | usually none | 11th-gen Core i3/i5 |
| HP Pavilion x360 15-dq2xxx | 15.6" touchscreen, 2-in-1 | on most models | 11th-gen Core i5/i7, pen support |

Both are ordinary Intel laptops that Linux supports well. The exact model decides two things:
whether a fingerprint reader exists and works, and whether the touchscreen and tablet mode
need setup.

## Find the exact model

Run either of these on the laptop and add the result to this file:

- **On Windows:** press Win+R and run `msinfo32`. Read *System Model* and *System SKU*.
- **On Linux (a live USB is enough):** `sudo dmidecode -s system-product-name; sudo dmidecode -s system-sku-number`

The sticker under the laptop also has the full product number, such as "14-dq2055cl".

## Expected drivers

| Part | Likely hardware | Linux driver | Status |
|---|---|---|---|
| CPU | Intel Core, 11th gen (Tiger Lake) | built in, `intel-ucode` | works |
| Graphics | Intel Iris Xe / UHD | `i915` (`xe` optional) | works; early KMS in the ISO |
| Wi-Fi | Realtek RTL8821CE/RTL8822CE or Intel AX201 | `rtw88` / `iwlwifi` | works; Realtek may need power saving turned off |
| Bluetooth | same card | `btusb` | works |
| Audio | Realtek codec on Intel HDA/SOF | `snd_hda_intel` / SOF firmware | works with `sof-firmware` |
| Touchpad | I2C HID (Synaptics/Elan) | `i2c_hid_acpi` | works; gestures through Hyprland |
| Keyboard hotkeys | HP WMI | `hp-wmi` | works |
| Webcam | UVC camera, no IR | `uvcvideo` | works; face unlock is convenience only |
| Fingerprint (x360) | Synaptics or Goodix USB | `libfprint` / `fprintd` | depends on the USB id; see below |
| Touchscreen (x360) | ELAN/Wacom HID | `hid_multitouch` | works; tablet mode switch through `intel-hid` |
| Storage | NVMe SSD | `nvme` | works |
| Firmware | UEFI with Secure Boot | systemd-boot | turn Secure Boot off for the first install |

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
