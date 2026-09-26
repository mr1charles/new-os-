# Dual Space

One password field at login. The password you type decides which space opens: your work
space, your personal space, a guest space. Each space is its own Linux account, so the
separation is real: files, apps, settings, keyring, and browser data belong to one account and
other spaces cannot read them.

## Pieces

| Piece | Runs as | Job |
|---|---|---|
| `newos-spacesd` | root, system D-Bus `org.newos.Spaces1` | knows the spaces; tells which space a password opens; creates and removes spaces |
| Greeter (`shell/widgets/Greeter.tsx`) | the `greeter` user under greetd | one password field; asks spacesd whose password it is, then logs that account in through greetd |
| Lock screen | the space's user | same field; a password for another space switches to it (fast user switching) |
| Settings → Users & Spaces | the space's user | lists spaces, creates and removes them (with administrator approval) |

Spaces are recorded in `/var/lib/newos/spaces.json` (name, account, accent, which one is the
default). Every space account is in the `newos-spaces` group.

## Resolving a password

`ResolvePassword(password)` tries the password against each space's account through PAM
(service `newos-spaces`, which is `pam_unix` without a failure delay), most recently used
space first, and returns the account it opens. It never logs a password and keeps it in
memory only for the call.

The actual login still goes through greetd and its own PAM stack: spacesd only says which
account to log in. A wrong answer from spacesd can at worst send the greeter to an account
whose password check then fails in greetd.

## Rules that keep it safe

- **Who may ask.** `ResolvePassword` answers only the `greeter` user, members of
  `newos-spaces`, and root (checked from the D-Bus sender's uid). Anyone else gets an
  access error, so an ordinary program cannot use spacesd to guess passwords.
- **Rate limit.** After 5 failed attempts in a minute, further attempts from that caller are
  refused for a lockout that doubles each time (30 s, 1 min, 2 min ... capped at 15 min). A
  success resets it. PAM's own `faillock` is not in the `newos-spaces` stack, because trying
  one password against several accounts would otherwise lock the accounts it did not match.
- **Unambiguous passwords.** Creating a space, or changing a space's password, is refused
  when the new password already opens another space. Otherwise one password could open two
  spaces and the result would depend on order.
- **Managing spaces needs an administrator.** `CreateSpace`, `DeleteSpace`, `RenameSpace`
  and `SetDefault` are checked with polkit (`org.newos.spaces.manage`, administrator
  authentication, remembered briefly).
- **Account names are generated**, never taken from input: `space-<slug>` from the space's
  name, validated against `[a-z][a-z0-9-]{0,30}`.
- **Face unlock never picks a space.** Webcam face matching (Howdy) can be fooled by a photo,
  so it may unlock the space you are already in but never open or switch to another one.

## Not in this milestone

- **Biometric login to a space** (M5.1): fingerprints cannot be passed to greetd as a
  password, so a small PAM module will accept a single-use token that spacesd mints after
  fprintd verified the finger. The reader on the HP (ELAN Match-on-Chip) works with fprintd.
- **Switching to a space that is not running yet** from the lock screen: spacesd starts a
  second greetd on another VT and hands it the login. Spaces that are already running are
  switched to with logind (`loginctl activate`).
- Encrypted homes per space (systemd-homed), M9.
