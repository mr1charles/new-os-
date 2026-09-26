import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import type Gdk from "gi://Gdk?version=4.0"
import GLib from "gi://GLib?version=2.0"
import { assetPath } from "../lib/icons"
import { startupTimeline, type StartupStep } from "../lib/startup"

/**
 * The HelixOS startup animation: the logo appears, the rest of the name ("elixOS") slides
 * out from its right so the logo becomes the H of HelixOS, a flash, and the desktop (or the
 * login screen) shows through. Plays over everything on one monitor, then destroys itself.
 * Clicking skips it. After a real boot, the Plymouth splash (distro/plymouth/helixos) shows
 * the logo first and the login screen continues from there (`fromBoot`).
 */
export function playStartup(
  gdkmonitor?: Gdk.Monitor,
  options: { fromBoot?: boolean; onDone?: () => void } = {},
) {
  const fromBoot = options.fromBoot ?? false
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
  const logo = new Gtk.Picture({
    cssClasses: ["startup-logo"],
    canShrink: true,
    contentFit: Gtk.ContentFit.CONTAIN,
    widthRequest: 132,
    heightRequest: 132,
  })
  logo.set_filename(assetPath("brand", "helixos-logo.svg"))
  const word = new Gtk.Label({
    cssClasses: ["startup-word"],
    useMarkup: true,
    label: 'elix<span weight="300">OS</span>',
    valign: Gtk.Align.CENTER,
  })
  const reveal = new Gtk.Revealer({
    transitionType: Gtk.RevealerTransitionType.SLIDE_RIGHT,
    transitionDuration: 750,
    child: word,
  })
  const mark = new Gtk.Box({
    cssClasses: ["startup-mark"],
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
    spacing: 4,
  })
  mark.append(logo)
  mark.append(reveal)
  const flash = new Gtk.Box({
    cssClasses: ["startup-flash"],
    hexpand: true,
    vexpand: true,
    canTarget: false,
  })
  const overlay = new Gtk.Overlay({ child: mark })
  overlay.add_overlay(flash)

  const window = new Astal.Window({
    name: "startup",
    namespace: "helixos-startup",
    // After the boot splash the logo is already on screen: start there, without fading in.
    cssClasses: ["startup-window", fromBoot ? "step-logo" : "step-start"],
    application: app,
    layer: Astal.Layer.OVERLAY,
    anchor: TOP | BOTTOM | LEFT | RIGHT,
    exclusivity: Astal.Exclusivity.IGNORE,
    keymode: Astal.Keymode.NONE,
    child: overlay,
  })
  if (gdkmonitor) window.gdkmonitor = gdkmonitor

  const sources: number[] = []
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    sources.forEach((id) => GLib.source_remove(id))
    window.destroy()
    options.onDone?.()
  }
  const apply = (step: StartupStep) => {
    if (step.name === "done") return finish()
    window.cssClasses = ["startup-window", `step-${step.name}`]
    if (step.name === "name") reveal.revealChild = true
  }
  for (const step of startupTimeline(fromBoot))
    sources.push(
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, step.at, () => {
        sources.shift()
        apply(step)
        return GLib.SOURCE_REMOVE
      }),
    )
  const click = new Gtk.GestureClick()
  click.connect("released", finish)
  window.add_controller(click)
  // Shown last: Astal applies the layer only before the window is mapped.
  window.visible = true
}
