# @newos/design-tokens

One source of truth for the look of NewOS: colors (light and dark), accents, typography, radii,
spacing, blur and motion curves.

`pnpm build` renders `tokens.json` into:

| File | Consumer |
|---|---|
| `dist/tokens.css` | Apps and `@newos/ui` (web CSS variables, dark via `prefers-color-scheme` or `data-theme`) |
| `dist/gtk-light.css`, `dist/gtk-dark.css` | The shell (GTK4 CSS custom properties, GTK 4.16+) |
| `dist/tokens.json` | Runtime consumers such as the Settings app |

Every variable is prefixed `--newos-` (for example `--newos-color-fg`, `--newos-accent`,
`--newos-radius-md`, `--newos-motion-spring`).
