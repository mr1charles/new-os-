# Dual Space

One password field at login. The password you type decides which space opens: your work
space, your personal space, a guest space. Each space is its own Linux account, so the
separation is real: files, apps, settings, keyring, and browser data belong to one account and
other spaces cannot read them.

## Pieces

| Piece | Runs as | Job |
|---|---|---|
| `helixos-spacesd` | root, system D-Bus `org.helixos.Spaces1` | knows the spaces; tells which space a password opens; creates and removes spaces |
| Greeter (`shell/widgets/Greeter.tsx`) | the `greeter` user under greetd | one password field; asks spacesd whose password it is, then logs that account in through greetd |
| Lock screen | the space's user | same field; your password unlocks, another running space's password switches to it (`SwitchTo`) |
| Settings → Users & Spaces | the space's user | lists spaces, creates and removes them (with administrator approval) |

Spaces are recorded in `/var/lib/helixos/spaces.json` (name, account, accent, which one is the
default). Every space account is in the `helixos-spaces` group.

## Resolving a password

`ResolvePassword(password)` tries the password against each space's account through PAM
(service `helixos-spaces`, which is `pam_unix` without a failure delay), most recently used
space first, and returns the account it opens. It never logs a password and keeps it in
memory only for the call.

The actual login still goes through greetd and its own PAM stack: spacesd only says which
account to log in. A wrong answer from spacesd can at worst send the greeter to an account
whose password check then fails in greetd.

## Rules that keep it safe

- **Who may ask.** `ResolvePassword` answers only the `greeter` user, members of
  `helixos-spaces`, and root (checked from the D-Bus sender's uid). Anyone else gets an
  access error, so an ordinary program cannot use spacesd to guess passwords.
- **Rate limit.** After 5 failed attempts in a minute, further attempts from that caller are
  refused for a lockout that doubles each time (30 s, 1 min, 2 min ... capped at 15 min). A
  success resets it. PAM's own `faillock` is not in the `helixos-spaces` stack, because trying
  one password against several accounts would otherwise lock the accounts it did not match.
- **Unambiguous passwords.** Creating a space, or changing a space's password, is refused
  when the new password already opens another space. Otherwise one password could open two
  spaces and the result would depend on order.
- **Managing spaces needs an administrator.** `CreateSpace`, `DeleteSpace`, `RenameSpace`
  and `SetDefault` are checked with polkit (`org.helixos.spaces.manage`, administrator
  authentication, remembered briefly).
- **Account names are generated**, never taken from input: `space-<slug>` from the space's
  name, validated against `[a-z][a-z0-9-]{0,30}`.
- **Face unlock never picks a space.** Webcam face matching (Howdy) can be fooled by a photo,
  so it may unlock the space you are already in but never open or switch to another one.

## Trying it

In testing mode (`scripts/live.sh run`), spacesd runs in demo mode with two pretend spaces:
"Work" opens with `work-demo`, "Personal" with `home-demo`. Lock the screen with Alt+L (Super+L
full screen); the container user's password `helixos` unlocks it, and the demo passwords are
recognized as other spaces. The login screen can be previewed without greetd:

```bash
scripts/live.sh exec sh -c 'cd $HELIXOS_REPO/shell && HELIXOS_GREETER_PREVIEW=1 ags run --gtk 4 greeter.ts'
```

Real accounts and PAM are checked by `services/spacesd/tests/pam-in-container.sh`, which runs as
the container's root and creates and removes throwaway accounts inside the container only.

## Not in this milestone

- **Biometric login to a space** (M5.1): fingerprints cannot be passed to greetd as a
  password, so a small PAM module will accept a single-use token that spacesd mints after
  fprintd verified the finger. The reader on the HP (ELAN Match-on-Chip) works with fprintd.
- **Starting a space that is not running yet** from the lock screen: spacesd will start a
  second greetd on another VT and hand it the login. Switching to a space that is already
  running works now (`SwitchTo`: logind activates its session; the one left behind stays
  locked).
- Encrypted homes per space (systemd-homed), M9.
