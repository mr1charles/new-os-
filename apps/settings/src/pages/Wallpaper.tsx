import { inTauri, resolveTheme, type Wallpaper } from "@helixos/sdk"
import { useAction, useCommand, useSettings } from "@helixos/sdk/react"
import { Button, cx, Group, Page, Row, SegmentedControl } from "@helixos/ui"
import { ImagePlus } from "lucide-react"
import { useEffect, useState } from "react"
import builtinDark from "../../../../shell/assets/wallpapers/helixos-dark.svg?url"
import builtinLight from "../../../../shell/assets/wallpapers/helixos-light.svg?url"
import { ActionError } from "../components/common"

type Variant = "light" | "dark"

/** Webviews cannot load file paths directly; Tauri serves them over its asset protocol. */
function useImageSrc() {
  const [convert, setConvert] = useState<((path: string) => string) | null>(null)
  useEffect(() => {
    if (inTauri())
      void import("@tauri-apps/api/core").then((m) => setConvert(() => m.convertFileSrc))
  }, [])
  return (path: string) => (convert ? convert(path) : path)
}

async function pickImage(): Promise<string | null> {
  if (!inTauri()) return null
  const { open } = await import("@tauri-apps/plugin-dialog")
  const picked = await open({
    title: "Choose a Picture",
    multiple: false,
    directory: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }],
  })
  return typeof picked === "string" ? picked : null
}

export function WallpaperPage() {
  const [settings, update] = useSettings()
  const found = useCommand("wallpapers")
  const src = useImageSrc()
  const [variant, setVariant] = useState<Variant>(() => resolveTheme(settings.appearance.theme))
  const key = variant === "light" ? "wallpaperLight" : "wallpaperDark"
  const selected = settings.appearance[key]

  const choose = (path: string) => void update({ appearance: { [key]: path } })
  const add = useAction(async () => {
    const path = await pickImage()
    if (path) choose(path)
  })

  const builtin: Wallpaper = { path: "", name: "HelixOS" }
  const list: Wallpaper[] = [builtin, ...(found.data ?? [])]
  if (selected && !list.some((w) => w.path === selected))
    list.push({ path: selected, name: selected.split("/").pop() ?? selected })

  return (
    <Page>
      <Group footer="Each appearance has its own wallpaper, so the desktop can change with light and dark mode.">
        <Row label="Wallpaper for">
          <SegmentedControl
            label="Wallpaper for"
            value={variant}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={setVariant}
          />
        </Row>
        <Row label="" stacked>
          <div className="settings-wallpapers" role="radiogroup" aria-label="Wallpapers">
            {list.map((w) => (
              <button
                key={w.path || "builtin"}
                type="button"
                role="radio"
                aria-checked={selected === w.path}
                title={w.name}
                className={cx(
                  "settings-wallpaper",
                  selected === w.path && "settings-wallpaper--selected",
                )}
                onClick={() => choose(w.path)}
              >
                <img
                  src={w.path ? src(w.path) : variant === "light" ? builtinLight : builtinDark}
                  alt={w.name}
                  loading="lazy"
                  draggable={false}
                />
              </button>
            ))}
          </div>
        </Row>
        <Row label="">
          <Button disabled={!inTauri() || add.pending} onClick={() => void add.run()}>
            <ImagePlus size={14} /> Add Picture…
          </Button>
        </Row>
      </Group>
      <ActionError error={add.error} />
      <p className="settings-footnote">
        Pictures in ~/Pictures/Wallpapers and /usr/share/backgrounds appear here automatically.
      </p>
    </Page>
  )
}
