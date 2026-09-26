/**
 * Live shell configuration backed by ~/.config/newos/shell.json. Edits from the Settings app
 * (or a text editor) apply immediately through a file monitor.
 */
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"
import { createState } from "ags"
import { cloneJson, parseConfig, type ShellConfig } from "@newos/sdk/settings-schema"

export const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), "newos"])
export const CONFIG_PATH = GLib.build_filenamev([CONFIG_DIR, "shell.json"])

function readConfigFile(): string | null {
  try {
    const [ok, bytes] = GLib.file_get_contents(CONFIG_PATH)
    return ok ? new TextDecoder().decode(bytes) : null
  } catch {
    return null
  }
}

const [config, setConfig] = createState<ShellConfig>(parseConfig(readConfigFile()), {
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
})

export { config }

let lastWritten = ""

function writeConfigFile(value: ShellConfig) {
  const text = JSON.stringify(value, null, 2) + "\n"
  lastWritten = text
  GLib.mkdir_with_parents(CONFIG_DIR, 0o755)
  GLib.file_set_contents(CONFIG_PATH, text)
}

/** Change the config and persist it. */
export function updateConfig(mutate: (draft: ShellConfig) => void) {
  const draft = cloneJson(config.peek())
  mutate(draft)
  setConfig(draft)
  writeConfigFile(draft)
}

const monitor = Gio.File.new_for_path(CONFIG_PATH).monitor_file(Gio.FileMonitorFlags.NONE, null)
monitor.connect("changed", (_monitor, _file, _other, event) => {
  if (
    event !== Gio.FileMonitorEvent.CHANGES_DONE_HINT &&
    event !== Gio.FileMonitorEvent.CREATED &&
    event !== Gio.FileMonitorEvent.DELETED
  ) {
    return
  }
  const text = readConfigFile()
  if (text !== null && text === lastWritten) return
  setConfig(parseConfig(text))
})

/** Keep a reference so the monitor is not garbage collected. */
export const configMonitor = monitor
