/**
 * An in-memory backend for developing and testing app UIs in a browser: `setMockBackend(
 * createMockBackend())`. State changes stick for the session, so toggles, pairing, and
 * connecting behave like the real thing. The sample data is the HP 14-dq2xxx NewOS targets.
 */
import type { AssistantSettings } from "./assistant"
import type {
  AudioDevices,
  BluetoothDevice,
  Commands,
  Monitor,
  PowerProfile,
  WifiNetwork,
} from "./commands"
import {
  NOTES_CHANGED_EVENT,
  type FileEntry,
  type FileKind,
  type NoteMeta,
  type TrashItem,
} from "./commands"
import { emitMockEvent, type MockBackend } from "./ipc"
import { applyPatch, SETTINGS_CHANGED_EVENT } from "./settings"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface MockOptions {
  /** Delay for slow operations (scans, pairing). 0 in tests. */
  latencyMs?: number
}

export function createMockBackend(options: MockOptions = {}): MockBackend {
  const latency = options.latencyMs ?? 600
  let settingsFile: Record<string, unknown> = {}
  let wifiEnabled = true
  let bluetoothEnabled = true
  let brightness = 0.7
  let powerProfile: PowerProfile = "balanced"
  let hasKey = false
  let assistantSettings: AssistantSettings = {
    mode: "auto",
    name: "Assistant",
    cloud_model: "claude-opus-5",
    effort: "medium",
    local_model: "qwen2.5:3b",
    share_window_title: true,
    store_history: true,
    allow_shell: true,
  }
  const hypr: Record<string, string> = {
    "input:kb_layout": "us",
    "input:kb_variant": "",
    "input:kb_options": "",
    "input:repeat_rate": "25",
    "input:repeat_delay": "600",
    "input:sensitivity": "0",
    "input:natural_scroll": "false",
    "input:touchpad:natural_scroll": "true",
    "input:touchpad:tap-to-click": "true",
    "input:touchpad:clickfinger_behavior": "true",
    "input:touchpad:disable_while_typing": "true",
    "input:touchpad:drag_lock": "false",
    "input:touchpad:scroll_factor": "0.6",
    "input:numlock_by_default": "false",
    "misc:key_press_enables_dpms": "true",
  }
  let networks: WifiNetwork[] = [
    { ssid: "Home Network", signal: 92, security: "WPA2", in_use: true, saved: true },
    { ssid: "Neighbor 5G", signal: 71, security: "WPA2", in_use: false, saved: false },
    { ssid: "Coffee Shop", signal: 54, security: "", in_use: false, saved: false },
    { ssid: "Office", signal: 38, security: "WPA2 802.1X", in_use: false, saved: true },
  ]
  let devices: BluetoothDevice[] = [
    {
      address: "11:22:33:44:55:66",
      name: "Headphones",
      icon: "audio-headset",
      paired: true,
      connected: true,
      trusted: true,
      battery: 80,
    },
    {
      address: "AA:BB:CC:DD:EE:01",
      name: "Wireless Mouse",
      icon: "input-mouse",
      paired: true,
      connected: false,
      trusted: true,
      battery: null,
    },
  ]
  const nearby: BluetoothDevice[] = [
    {
      address: "AA:BB:CC:DD:EE:02",
      name: "Speaker",
      icon: "audio-speakers",
      paired: false,
      connected: false,
      trusted: false,
      battery: null,
    },
  ]
  const audio: AudioDevices = {
    outputs: [
      { id: 56, name: "Speaker", is_default: true, volume: { level: 0.45, muted: false } },
      { id: 55, name: "HDMI 1", is_default: false, volume: { level: 1, muted: false } },
    ],
    inputs: [
      {
        id: 58,
        name: "Digital Microphone",
        is_default: true,
        volume: { level: 0.8, muted: false },
      },
      { id: 57, name: "Stereo Microphone", is_default: false, volume: { level: 1, muted: false } },
    ],
  }
  let monitors: Monitor[] = [
    {
      name: "eDP-1",
      description: "Chimei Innolux Corporation 0x14D4",
      width: 1920,
      height: 1080,
      refresh_rate: 60,
      x: 0,
      y: 0,
      scale: 1,
      transform: 0,
      disabled: false,
      focused: true,
      physical_width: 310,
      physical_height: 170,
      available_modes: ["1920x1080@60.00Hz", "1600x900@60.00Hz", "1280x720@60.00Hz"],
    },
  ]
  const facts = [
    { id: 1, text: "Prefers the metric system", created_at: 1789900000 },
    { id: 2, text: "Works on the NewOS project", created_at: 1789950000 },
  ]

  // Notes: path -> text, plus folders and pins, with the same naming rules as appkit::notes.
  const noteTexts = new Map<string, { text: string; modified: number }>([
    [
      "Welcome.md",
      {
        text: "# Welcome to Notes\n\nNotes are Markdown files in ~/Notes.\n\n- [x] Write a note\n- [ ] Ask the assistant to summarize it\n",
        modified: Date.now() - 60_000,
      },
    ],
    [
      "Groceries.md",
      {
        text: "# Groceries\n\n- [ ] Milk\n- [ ] Eggs\n- [x] Coffee\n",
        modified: Date.now() - 3_600_000,
      },
    ],
    [
      "Work/Q4 plan.md",
      {
        text: "# Q4 plan\n\nShip the NewOS installer and Dual Space.\n",
        modified: Date.now() - 86_400_000,
      },
    ],
  ])
  const noteFolders = new Set(["Work"])
  const pins = new Set<string>(["Groceries.md"])
  const noteTitle = (text: string) =>
    text
      .split("\n")
      .map((l) => l.replace(/^#+/, "").trim())
      .find(Boolean) ?? "New Note"
  const noteMeta = (path: string): NoteMeta => {
    const entry = noteTexts.get(path)!
    const lines = entry.text.split("\n").filter((l) => l.trim())
    return {
      path,
      folder: path.includes("/") ? path.split("/")[0]! : "",
      title: noteTitle(entry.text),
      preview: lines
        .slice(1)
        .map((l) => l.replace(/^[-*>#\s[\]x]+/, ""))
        .join(" ")
        .slice(0, 140),
      modified: entry.modified,
      pinned: pins.has(path),
    }
  }
  const freeNotePath = (folder: string, title: string, current?: string) => {
    const stem =
      title
        .replace(/[^\p{L}\p{N} _-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim() || "New Note"
    const prefix = folder ? `${folder}/` : ""
    let path = `${prefix}${stem}.md`
    for (let n = 2; noteTexts.has(path) && path !== current; n++) path = `${prefix}${stem} ${n}.md`
    return path
  }
  const notesChanged = () => emitMockEvent(NOTES_CHANGED_EVENT, null)
  const noteList = () =>
    [...noteTexts.keys()]
      .map(noteMeta)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.modified - a.modified)

  // Files: a small in-memory home folder.
  const HOME = "/home/a"
  const day = 86_400_000
  const fsNodes = new Map<
    string,
    { dir: boolean; modified: number; text?: string; size?: number }
  >()
  const addNode = (
    path: string,
    dir: boolean,
    ageDays: number,
    extra: { text?: string; size?: number } = {},
  ) => fsNodes.set(path, { dir, modified: Date.now() - ageDays * day, ...extra })
  for (const d of [
    "",
    "/Desktop",
    "/Documents",
    "/Documents/Work",
    "/Downloads",
    "/Pictures",
    "/Music",
    "/Videos",
    "/Notes",
  ]) {
    addNode(HOME + d, true, 10)
  }
  addNode(`${HOME}/Documents/Taxes 2026.pdf`, false, 200, { size: 482_113 })
  addNode(`${HOME}/Documents/Resume.docx`, false, 40, { size: 38_200 })
  addNode(`${HOME}/Documents/Budget.xlsx`, false, 12, { size: 21_004 })
  addNode(`${HOME}/Documents/Work/Q4 plan.md`, false, 1, {
    text: "# Q4 plan\n\nShip the NewOS installer and Dual Space.\n",
  })
  addNode(`${HOME}/Documents/ideas.txt`, false, 3, {
    text: "Ideas\n- A Dynamic Island for timers\n- Ask my notes\n",
  })
  addNode(`${HOME}/Downloads/archlinux.iso`, false, 5, { size: 1_234_567_890 })
  addNode(`${HOME}/Downloads/installer.exe`, false, 2, { size: 5_300_000 })
  addNode(`${HOME}/Pictures/Beach.jpg`, false, 30, { size: 2_400_000 })
  addNode(`${HOME}/Pictures/Screenshot 2026-09-26.png`, false, 0, { size: 380_000 })
  addNode(`${HOME}/Music/Song.flac`, false, 90, { size: 31_000_000 })
  addNode(`${HOME}/.bashrc`, false, 300, { text: "# bash config\n" })
  const trashed: (TrashItem & {
    node: { dir: boolean; modified: number; text?: string; size?: number }
  })[] = []
  const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1)
  const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/"
  const extKind = (name: string, dir: boolean): FileKind => {
    if (dir) return "folder"
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : ""
    const map: Record<string, FileKind> = {
      pdf: "pdf",
      docx: "document",
      xlsx: "spreadsheet",
      md: "text",
      txt: "text",
      iso: "archive",
      exe: "app",
      jpg: "image",
      png: "image",
      flac: "audio",
      bashrc: "other",
    }
    return map[ext] ?? "other"
  }
  const fileEntry = (path: string): FileEntry => {
    const node = fsNodes.get(path)!
    const name = baseName(path)
    const children = [...fsNodes.keys()].filter((p) => parentOf(p) === path).length
    return {
      name,
      path,
      kind: extKind(name, node.dir),
      size: node.dir ? children : (node.size ?? node.text?.length ?? 0),
      modified: node.modified,
      hidden: name.startsWith("."),
      symlink: false,
    }
  }
  const freePath = (dir: string, name: string) => {
    if (!fsNodes.has(`${dir}/${name}`)) return `${dir}/${name}`
    const dot = name.lastIndexOf(".")
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
    for (let n = 2; ; n++)
      if (!fsNodes.has(`${dir}/${stem} ${n}${ext}`)) return `${dir}/${stem} ${n}${ext}`
  }
  const moveTree = (from: string, to: string, keep: boolean) => {
    for (const [path, node] of [...fsNodes.entries()]) {
      if (path === from || path.startsWith(`${from}/`)) {
        fsNodes.set(to + path.slice(from.length), {
          ...node,
          modified: keep ? node.modified : Date.now(),
        })
        if (!keep) fsNodes.delete(path)
      }
    }
  }
  const byName = (a: FileEntry, b: FileEntry) =>
    Number(b.kind === "folder") - Number(a.kind === "folder") ||
    a.name.localeCompare(b.name, undefined, { numeric: true })

  // Terminal: a pretend shell that echoes what you type.
  const mockPrompt = "\x1b[1;34m~\x1b[0m $ "
  const mockTerminals = new Map<
    number,
    { line: string; emit: (e: { type: string; text?: string }) => void }
  >()
  let nextTerminal = 1

  const find = (address: unknown) => {
    const device = [...devices, ...nearby].find((d) => d.address === address)
    if (!device) throw new Error(`no device ${String(address)}`)
    return device
  }

  const backend: { [K in keyof Commands]?: (args: Record<string, unknown>) => unknown } = {
    settings_read: () => settingsFile,
    settings_update: ({ patch }) => {
      settingsFile = applyPatch(settingsFile, patch)
      emitMockEvent(SETTINGS_CHANGED_EVENT, settingsFile)
      return settingsFile
    },

    assistant_request: ({ method, path, body }) => {
      if (path === "/v1/status") {
        const cloudReady = hasKey && assistantSettings.mode !== "local"
        return {
          version: "0.1.0",
          mode: assistantSettings.mode,
          active: cloudReady ? "cloud" : "local",
          online: true,
          cloud: {
            configured: hasKey,
            model: assistantSettings.cloud_model,
            key_source: hasKey ? "keyring" : null,
          },
          local: {
            available: true,
            model: assistantSettings.local_model,
            url: "http://127.0.0.1:11434",
          },
          assistant_name: assistantSettings.name,
        }
      }
      if (path === "/v1/facts" && method === "GET") return { facts }
      if (typeof path === "string" && path.startsWith("/v1/facts/") && method === "DELETE") {
        const index = facts.findIndex((f) => `/v1/facts/${f.id}` === path)
        if (index >= 0) facts.splice(index, 1)
        return { ok: true }
      }
      if (path === "/v1/complete") {
        const input = String((body as { input?: string })?.input ?? "")
        return { output: `(mock) ${input.slice(0, 60)}`, provider: "local", model: "mock" }
      }
      throw new Error(`the assistant is not running (mock: ${String(path)})`)
    },
    assistant_settings_read: () => assistantSettings,
    assistant_settings_set: ({ field, value }) => {
      assistantSettings = { ...assistantSettings, [field as string]: value }
      return assistantSettings
    },
    assistant_key_status: () => hasKey,
    assistant_key_store: ({ key }) => {
      if (typeof key !== "string" || !key.startsWith("sk-ant-")) {
        throw new Error('That doesn\'t look like an Anthropic API key (it starts with "sk-ant-").')
      }
      hasKey = true
      return null
    },
    assistant_key_clear: () => {
      hasKey = false
      return null
    },
    assistant_restart: () => null,

    wifi_status: () => {
      const active = networks.find((n) => n.in_use)
      return {
        enabled: wifiEnabled,
        ssid: wifiEnabled ? (active?.ssid ?? null) : null,
        signal: wifiEnabled ? (active?.signal ?? null) : null,
      }
    },
    wifi_set_enabled: ({ enabled }) => {
      wifiEnabled = Boolean(enabled)
      return null
    },
    wifi_networks: async ({ rescan }) => {
      if (rescan) await wait(latency)
      return wifiEnabled ? networks : []
    },
    wifi_connect: async ({ ssid, password }) => {
      await wait(latency)
      const network = networks.find((n) => n.ssid === ssid)
      if (!network) throw new Error(`${String(ssid)} is out of range`)
      if (network.security && !network.saved && !password) throw new Error("A password is required")
      if (password === "wrong") throw new Error("Secrets were required, but not provided")
      networks = networks.map((n) => ({
        ...n,
        in_use: n.ssid === ssid,
        saved: n.saved || n.ssid === ssid,
      }))
      return null
    },
    wifi_disconnect: ({ ssid }) => {
      networks = networks.map((n) => (n.ssid === ssid ? { ...n, in_use: false } : n))
      return null
    },
    wifi_forget: ({ ssid }) => {
      networks = networks.map((n) => (n.ssid === ssid ? { ...n, in_use: false, saved: false } : n))
      return null
    },
    net_devices: () => [
      {
        device: "wlan0",
        kind: "wifi",
        state: "connected",
        connection: networks.find((n) => n.in_use)?.ssid ?? "",
        ipv4: ["192.168.1.129/24"],
        gateway: "192.168.1.1",
        dns: ["192.168.1.1"],
        mac: "C8:94:02:06:75:D3",
      },
    ],
    airplane_get: () => !wifiEnabled && !bluetoothEnabled,
    airplane_set: ({ enabled }) => {
      wifiEnabled = bluetoothEnabled = !enabled
      return null
    },

    bluetooth_powered: () => bluetoothEnabled,
    bluetooth_set_enabled: ({ enabled }) => {
      bluetoothEnabled = Boolean(enabled)
      return null
    },
    bluetooth_devices: () => (bluetoothEnabled ? devices : []),
    bluetooth_scan: async () => {
      await wait(latency * 2)
      for (const device of nearby) {
        if (!devices.includes(device)) devices = [...devices, device]
      }
      return devices
    },
    bluetooth_pair: async ({ address }) => {
      await wait(latency)
      Object.assign(find(address), { paired: true, trusted: true, connected: true })
      return null
    },
    bluetooth_connect: async ({ address }) => {
      await wait(latency)
      find(address).connected = true
      return null
    },
    bluetooth_disconnect: ({ address }) => {
      find(address).connected = false
      return null
    },
    bluetooth_remove: ({ address }) => {
      devices = devices.filter((d) => d.address !== address)
      Object.assign(find(address), { paired: false, connected: false, trusted: false })
      return null
    },

    audio_devices: () => structuredClone(audio),
    audio_set_default: ({ id }) => {
      for (const list of [audio.outputs, audio.inputs]) {
        if (list.some((d) => d.id === id)) list.forEach((d) => (d.is_default = d.id === id))
      }
      return null
    },
    audio_set_volume: ({ id, level, muted }) => {
      const device = [...audio.outputs, ...audio.inputs].find((d) => d.id === id)
      if (device) device.volume = { level: Number(level), muted: Boolean(muted) }
      return null
    },

    brightness_get: () => brightness,
    brightness_set: ({ level }) => (brightness = Math.max(0.01, Math.min(1, Number(level)))),
    monitors: () => monitors,
    monitor_apply: ({ setup }) => {
      const s = setup as Commands["monitor_apply"][0]["setup"]
      monitors = monitors.map((m) =>
        m.name === s.name ? { ...m, scale: s.scale, x: s.x, y: s.y } : m,
      )
      return `${s.name},${s.mode},${s.x}x${s.y},${s.scale}`
    },
    wallpapers: () => [],

    power_profiles: () => ({
      active: powerProfile,
      available: ["power-saver", "balanced", "performance"],
    }),
    power_profile_set: ({ profile }) => {
      powerProfile = profile as PowerProfile
      return null
    },
    battery_details: () => ({
      percent: 96,
      state: "Charging",
      health: 68,
      cycle_count: 120,
      power_watts: 11.4,
      on_ac: true,
    }),

    hypr_options: () => ({ ...hypr }),
    hypr_option_set: ({ key, value }) => {
      hypr[String(key)] = String(value)
      return String(value)
    },

    notes_list: () => noteList(),
    notes_folders: () => [...noteFolders].sort(),
    notes_search: ({ query }) => {
      const words = String(query).toLowerCase().split(/\s+/).filter(Boolean)
      if (words.length === 0) return []
      return noteList()
        .filter((n) => words.every((w) => noteTexts.get(n.path)!.text.toLowerCase().includes(w)))
        .map((note) => ({
          note,
          snippet:
            noteTexts
              .get(note.path)!
              .text.split("\n")
              .slice(1)
              .find((l) => l.toLowerCase().includes(words[0]!)) ?? note.preview,
          score: note.title.toLowerCase().includes(words[0]!) ? 3 : 1,
        }))
        .sort((a, b) => b.score - a.score)
    },
    note_read: ({ path }) => {
      const entry = noteTexts.get(String(path))
      if (!entry) throw new Error("No such note")
      return entry.text
    },
    note_write: ({ path, text }) => {
      const current = String(path)
      if (!noteTexts.has(current)) throw new Error("No such note")
      const folder = current.includes("/") ? current.split("/")[0]! : ""
      const title = noteTitle(String(text))
      const oldStem = current.replace(/^.*\//, "").replace(/\.md$/, "")
      const target =
        oldStem === title ||
        (oldStem.startsWith(`${title} `) && /^\d+$/.test(oldStem.slice(title.length + 1)))
          ? current
          : freeNotePath(folder, title, current)
      noteTexts.delete(current)
      noteTexts.set(target, { text: String(text), modified: Date.now() })
      if (pins.delete(current)) pins.add(target)
      notesChanged()
      return noteMeta(target)
    },
    note_create: ({ folder, text }) => {
      const body = String(text).trim() ? String(text) : "# New Note\n\n"
      const path = freeNotePath(String(folder), noteTitle(body))
      noteTexts.set(path, { text: body, modified: Date.now() })
      notesChanged()
      return noteMeta(path)
    },
    note_delete: ({ path }) => {
      noteTexts.delete(String(path))
      pins.delete(String(path))
      notesChanged()
      return null
    },
    note_set_pinned: ({ path, pinned }) => {
      if (pinned) pins.add(String(path))
      else pins.delete(String(path))
      notesChanged()
      return null
    },
    note_move: ({ path, folder }) => {
      const entry = noteTexts.get(String(path))
      if (!entry) throw new Error("No such note")
      const target = freeNotePath(String(folder), noteTitle(entry.text))
      noteTexts.delete(String(path))
      noteTexts.set(target, entry)
      if (pins.delete(String(path))) pins.add(target)
      notesChanged()
      return noteMeta(target)
    },
    notes_folder_create: ({ name }) => {
      noteFolders.add(String(name))
      notesChanged()
      return String(name)
    },
    notes_folder_delete: ({ name }) => {
      if ([...noteTexts.keys()].some((p) => p.startsWith(`${String(name)}/`))) {
        throw new Error(`“${String(name)}” still has notes in it.`)
      }
      noteFolders.delete(String(name))
      notesChanged()
      return null
    },

    files_places: () =>
      [
        ["home", "Home", ""],
        ["desktop", "Desktop", "/Desktop"],
        ["documents", "Documents", "/Documents"],
        ["downloads", "Downloads", "/Downloads"],
        ["pictures", "Pictures", "/Pictures"],
        ["music", "Music", "/Music"],
        ["videos", "Videos", "/Videos"],
      ].map(([id, name, sub]) => ({ id: id!, name: name!, path: HOME + sub })),
    files_list: ({ path, showHidden }) => {
      if (!fsNodes.get(String(path))?.dir) throw new Error(`${String(path)} is not a folder`)
      return [...fsNodes.keys()]
        .filter((p) => parentOf(p) === path)
        .map(fileEntry)
        .filter((e) => showHidden || !e.hidden)
        .sort(byName)
    },
    files_info: ({ path }) => {
      if (!fsNodes.has(String(path))) throw new Error(`${String(path)} does not exist`)
      return fileEntry(String(path))
    },
    files_drives: () => [
      {
        device: "/dev/sda1",
        name: "USB STICK",
        size: 32_000_000_000,
        mount_point: null,
        removable: true,
        filesystem: "vfat",
      },
    ],
    files_mount: () => "/run/media/a/USB STICK",
    files_eject: () => null,
    files_create_folder: ({ dir, name }) => {
      const path = freePath(String(dir), String(name))
      addNode(path, true, 0)
      return fileEntry(path)
    },
    files_rename: ({ path, name }) => {
      const target = `${parentOf(String(path))}/${String(name)}`
      if (fsNodes.has(target)) throw new Error(`“${String(name)}” already exists here.`)
      moveTree(String(path), target, false)
      return fileEntry(target)
    },
    files_transfer: ({ sources, dest, moveFiles }) =>
      (sources as string[]).map((source) => {
        const target =
          moveFiles && parentOf(source) === dest ? source : freePath(String(dest), baseName(source))
        if (target !== source) moveTree(source, target, !moveFiles)
        return target
      }),
    files_trash: ({ paths }) => {
      for (const path of paths as string[]) {
        const node = fsNodes.get(path)
        if (!node) continue
        trashed.unshift({
          id: `${baseName(path)}.${trashed.length}`,
          name: baseName(path),
          original_path: path,
          deleted: new Date().toISOString().slice(0, 19),
          kind: extKind(baseName(path), node.dir),
          size: node.size ?? null,
          node,
        })
        for (const p of [...fsNodes.keys()])
          if (p === path || p.startsWith(`${path}/`)) fsNodes.delete(p)
      }
      return null
    },
    files_trash_list: () => trashed.map(({ node: _node, ...item }) => item),
    files_trash_restore: ({ id }) => {
      const i = trashed.findIndex((t) => t.id === id)
      if (i < 0) throw new Error("Not in the Trash")
      const item = trashed.splice(i, 1)[0]!
      const target = freePath(parentOf(item.original_path), item.name)
      fsNodes.set(target, item.node)
      return target
    },
    files_trash_empty: () => trashed.splice(0).length,
    files_open: () => null,
    files_preview_text: ({ path }) => fsNodes.get(String(path))?.text ?? null,
    files_document_text: ({ path }) => fsNodes.get(String(path))?.text ?? null,
    files_pdf_thumbnail: () => {
      throw new Error("No thumbnails in the sample data")
    },
    files_search: ({ root, query, limit }) => {
      const q = query as {
        words: string[]
        kinds: FileKind[]
        modified_after: number | null
        modified_before: number | null
      }
      return [...fsNodes.keys()]
        .filter((p) => p.startsWith(`${String(root)}/`))
        .map(fileEntry)
        .filter((e) => !e.hidden)
        .filter((e) => q.words.every((w) => e.name.toLowerCase().includes(w.toLowerCase())))
        .filter((e) => q.kinds.length === 0 || q.kinds.includes(e.kind))
        .filter(
          (e) =>
            (q.modified_after ?? 0) <= e.modified && e.modified <= (q.modified_before ?? Infinity),
        )
        .sort((a, b) => b.modified - a.modified)
        .slice(0, Number(limit))
    },

    term_write: ({ id, data }) => {
      const session = mockTerminals.get(Number(id))
      if (!session) throw new Error(`no terminal ${String(id)}`)
      for (const ch of String(data)) {
        if (ch === "\r") {
          const line = session.line.trim()
          session.line = ""
          const reply = line === "" ? "" : line === "exit" ? null : `mock shell: ran “${line}”\r\n`
          if (reply === null) {
            session.emit({ type: "exit" })
            mockTerminals.delete(Number(id))
            return null
          }
          session.emit({ type: "data", text: `\r\n${reply}${mockPrompt}` })
        } else if (ch === "\x7f") {
          if (session.line) {
            session.line = session.line.slice(0, -1)
            session.emit({ type: "data", text: "\b \b" })
          }
        } else if (ch >= " ") {
          session.line += ch
          session.emit({ type: "data", text: ch })
        }
      }
      return null
    },
    term_resize: () => null,
    term_kill: ({ id }) => {
      mockTerminals.delete(Number(id))
      return null
    },
    term_cwd: () => "/home/a",

    apps: () =>
      [
        ["newos-files", "Files"],
        ["firefox", "Firefox"],
        ["newos-notes", "Notes"],
        ["newos-terminal", "Terminal"],
        ["kitty", "kitty"],
        ["newos-settings", "Settings"],
        ["org.gnome.Calculator", "Calculator"],
      ].map(([id, name]) => ({
        id: `${id}.desktop`,
        name,
        generic_name: null,
        keywords: [],
        exec: id,
        icon: id,
      })),

    about: () => ({
      hostname: "newos",
      vendor: "HP",
      model: "HP Laptop 14-dq2xxx",
      sku: "50V33UA#ABA",
      firmware: "F.33",
      cpu: "11th Gen Intel(R) Core(TM) i3-1125G4 @ 2.00GHz",
      cpu_cores: 8,
      memory_bytes: 16387645440,
      graphics: ["Intel Corporation Tiger Lake-LP GT2 [UHD Graphics G4]"],
      base_os: "Arch Linux",
      kernel: "7.2.6-zen1",
      disk_total_bytes: 251763412992,
      disk_free_bytes: 217525903360,
    }),
    account: () => ({
      username: "a",
      full_name: "a",
      uid: 1000,
      home: "/home/a",
      shell: "/bin/fish",
      admin: true,
    }),
    fingerprints: () => ({
      available: true,
      device: "ELAN Match-on-Chip 2",
      enrolled: ["right-middle-finger"],
    }),
    updates: async () => {
      await wait(latency)
      return [
        { name: "linux-zen", from: "7.2.6.zen1-1", to: "7.2.7.zen1-1", source: "system" },
        { name: "mesa", from: "1:26.2.1-1", to: "1:26.2.2-1", source: "system" },
      ]
    },
    update_in_terminal: () => null,
  }

  return {
    ...backend,
    // Streaming chat for the mock: a short reply in two chunks.
    ...({
      term_spawn: ({ onEvent }: { onEvent: (e: { type: string; text?: string }) => void }) => {
        const id = nextTerminal++
        mockTerminals.set(id, { line: "", emit: onEvent })
        setTimeout(
          () =>
            onEvent({
              type: "data",
              text: `Welcome to the NewOS Terminal (sample shell).\r\n${mockPrompt}`,
            }),
          0,
        )
        return id
      },
      assistant_stream: async ({ onChunk }: { onChunk: (chunk: string) => void }) => {
        onChunk(
          'event: start\ndata: {"conversation_id":"mock","provider":"local","model":"mock"}\n\n',
        )
        await wait(latency / 4)
        onChunk(
          'event: text\ndata: {"delta":"Hello from the mock assistant."}\n\nevent: done\ndata: {"stop_reason":"end_turn"}\n\n',
        )
      },
    } as MockBackend),
  }
}
