/**
 * The window part of the settings, as Hyprland config: layout mode (floating, arrange,
 * tiling), corner radius, gaps, blur, and animation level. The shell writes it to
 * ~/.config/newos/hyprland-windows.conf, which the session sources, and reloads Hyprland when
 * it changes. Pure, tested in Node.
 */
import type { ShellConfig } from "@newos/sdk/settings-schema"

export function windowStyleConf(config: Pick<ShellConfig, "windows" | "appearance">): string {
  const w = config.windows
  const lines = ["# Written by the HelixOS shell from Settings. Changes here are overwritten.", ""]
  if (w.layout !== "tiling") {
    // Floating by default, like macOS; "arrange" re-arranges floating windows itself.
    lines.push("windowrule = float on, match:class .*", "windowrule = center on, match:float true")
  }
  lines.push("windowrule = float on, pin on, match:title ^(Picture-in-Picture)$", "")
  const inner = Math.round(w.gaps / 2)
  lines.push(
    "general {",
    `    gaps_in = ${inner}`,
    `    gaps_out = ${w.gaps}`,
    "}",
    "decoration {",
    `    rounding = ${w.rounding}`,
    "    blur {",
    `        enabled = ${w.blur && !config.appearance.reduceTransparency ? "true" : "false"}`,
    "    }",
    "}",
  )
  if (w.animations === "off") {
    lines.push("animations {", "    enabled = false", "}")
  } else if (w.animations === "reduced") {
    lines.push(
      "animations {",
      "    animation = windowsIn, 1, 2, smooth, popin 95%",
      "    animation = windowsOut, 1, 2, smooth, popin 95%",
      "    animation = windowsMove, 1, 2, smooth",
      "    animation = workspaces, 1, 3, smooth, fade",
      "    animation = specialWorkspace, 1, 3, smooth, fade",
      "}",
    )
  }
  return lines.join("\n") + "\n"
}
