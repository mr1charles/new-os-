import { accentColor, accentNames } from "@helixos/design-tokens"
import { resolveTheme, type ThemePreference } from "@helixos/sdk"
import { useSettings } from "@helixos/sdk/react"
import { cx, Group, Page, Row, Toggle } from "@helixos/ui"

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
]

/** A tiny window drawing for the appearance picker. */
function ThemePreview({ theme }: { theme: ThemePreference }) {
  return (
    <span
      className={cx("settings-theme-preview", `settings-theme-preview--${theme}`)}
      aria-hidden="true"
    >
      <span className="settings-theme-preview__window">
        <span className="settings-theme-preview__bar" />
        <span className="settings-theme-preview__accent" />
      </span>
    </span>
  )
}

export function AppearancePage() {
  const [settings, update] = useSettings()
  const { theme: preference, accent, reduceTransparency } = settings.appearance
  const shown = resolveTheme(preference)
  return (
    <Page>
      <Group
        footer={
          preference === "auto" ? "Auto is light from 7 AM to 7 PM and dark at night." : undefined
        }
      >
        <Row label="Appearance" stacked>
          <div className="settings-theme-picker" role="radiogroup" aria-label="Appearance">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={preference === t.value}
                className={cx(
                  "settings-theme-option",
                  preference === t.value && "settings-theme-option--selected",
                )}
                onClick={() => void update({ appearance: { theme: t.value } })}
              >
                <ThemePreview theme={t.value} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </Row>
        <Row label="Accent color">
          <div className="settings-swatches" role="radiogroup" aria-label="Accent color">
            {accentNames.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={accent === name}
                aria-label={name.charAt(0).toUpperCase() + name.slice(1)}
                title={name.charAt(0).toUpperCase() + name.slice(1)}
                className={cx("settings-swatch", accent === name && "settings-swatch--selected")}
                style={{ background: accentColor(name, shown) }}
                onClick={() => void update({ appearance: { accent: name } })}
              />
            ))}
          </div>
        </Row>
        <Row
          label="Reduce transparency"
          description="Solid backgrounds instead of blur in the menu bar, Dock, and sidebars."
        >
          <Toggle
            label="Reduce transparency"
            checked={reduceTransparency}
            onChange={(v) => void update({ appearance: { reduceTransparency: v } })}
          />
        </Row>
      </Group>
      <Group title="Menu Bar Clock">
        <Row label="Use a 24-hour clock">
          <Toggle
            label="Use a 24-hour clock"
            checked={settings.bar.clock24h}
            onChange={(v) => void update({ bar: { clock24h: v } })}
          />
        </Row>
        <Row label="Show seconds">
          <Toggle
            label="Show seconds"
            checked={settings.bar.showSeconds}
            onChange={(v) => void update({ bar: { showSeconds: v } })}
          />
        </Row>
      </Group>
    </Page>
  )
}
