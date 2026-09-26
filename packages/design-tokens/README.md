# @helixos/design-tokens

One source of truth for the look of HelixOS: colors (light and dark), accents, typography, radii,
spacing, blur and motion curves.

`pnpm build` renders `tokens.json` into:

| File | Consumer |
|---|---|
| `dist/tokens.css` | Apps and `@helixos/ui` (web CSS variables, dark via `prefers-color-scheme` or `data-theme`) |
| `dist/gtk-light.css`, `dist/gtk-dark.css` | The shell (GTK4 CSS custom properties, GTK 4.16+) |
| `dist/tokens.json` | Runtime consumers such as the Settings app |

Every variable is prefixed `--helixos-` (for example `--helixos-color-fg`, `--helixos-accent`,
`--helixos-radius-md`, `--helixos-motion-spring`).
