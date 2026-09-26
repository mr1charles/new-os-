# Boot splash

`helixos/` is a Plymouth script theme: the HelixOS logo fades in on black while the computer
starts. The login screen then continues the same animation — the rest of the name slides out
from the logo's right, a white flash, and the login screen appears
(`shell/widgets/Startup.tsx`, `playStartup(monitor, { fromBoot: true })`).

Install (milestone 8 does this in the installer):

```sh
sudo cp -r distro/plymouth/helixos /usr/share/plymouth/themes/
sudo plymouth-set-default-theme -R helixos   # rebuilds the initramfs
```

`logo.png` is `shell/assets/brand/helixos-logo.svg` rendered at 132 px (the size the shell's
animation uses, so the hand-off lines up):

```sh
rsvg-convert -w 132 -h 132 shell/assets/brand/helixos-logo.svg -o distro/plymouth/helixos/logo.png
```

Try it without rebooting: `sudo plymouthd; sudo plymouth show-splash; sleep 5; sudo plymouth quit`.
