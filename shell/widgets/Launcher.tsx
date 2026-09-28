import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import Pango from "gi://Pango?version=1.0"
import { createComputed, createState, For, With, type Accessor } from "ags"
import PopupWindow from "./PopupWindow"
import { appList, toSearchable } from "../lib/apps"
import { buildResults, type SearchResult } from "../lib/search"
import { hidePopup, launcherMode, showPopup } from "../lib/popups"
import { config } from "../lib/config"
import { copyToClipboard, openSettings, openUrl, spawn } from "../lib/system"
import { send } from "../lib/assistant-session"
import { setImageSource } from "../lib/icons"
import type AstalApps from "gi://AstalApps"

const GRID_COLUMNS = 7
const MAX_RESULTS = 9

function activateResult(result: SearchResult) {
  hidePopup("launcher")
  switch (result.kind) {
    case "app":
      appList
        .peek()
        .find((a) => a.entry === result.entry)
        ?.launch()
      break
    case "setting":
      openSettings(result.page)
      break
    case "calc":
      copyToClipboard(result.value)
      break
    case "assistant":
      showPopup("assistant")
      send(result.prompt)
      break
    case "web":
      openUrl(result.url)
      break
    case "install":
      spawn(["helixos-open", result.target])
      break
  }
}

function ResultRow(props: {
  result: SearchResult
  index: number
  selected: Accessor<boolean>
  select: () => void
}) {
  return (
    <button
      class={props.selected.as(
        (on) => `launcher-result kind-${props.result.kind} ${on ? "selected" : ""}`,
      )}
      onClicked={() => activateResult(props.result)}
    >
      <Gtk.EventControllerMotion onEnter={props.select} />
      <box spacing={12}>
        <image
          pixelSize={props.index === 0 ? 36 : 28}
          $={(self) => setImageSource(self, props.result.iconName, "application-x-executable")}
        />
        <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER} hexpand>
          <label
            class="result-title"
            label={props.result.title}
            xalign={0}
            ellipsize={Pango.EllipsizeMode.END}
          />
          <label
            class="result-subtitle"
            label={props.result.subtitle}
            xalign={0}
            ellipsize={Pango.EllipsizeMode.END}
          />
        </box>
        <label class="result-hint" label="↵" visible={props.selected} />
      </box>
    </button>
  )
}

function chunk<T>(list: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size))
  return rows
}

/** Launchpad: every app in a grid, alphabetical. */
function AppGrid() {
  const rows = appList.as((apps) =>
    chunk(
      [...apps].sort((a, b) => a.name.localeCompare(b.name)),
      GRID_COLUMNS,
    ),
  )
  const cell = (application: AstalApps.Application) => (
    <button
      class="grid-app"
      tooltipText={application.description || application.name}
      onClicked={() => {
        hidePopup("launcher")
        application.launch()
      }}
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
        <image
          pixelSize={64}
          $={(self) => setImageSource(self, application.iconName, "application-x-executable")}
        />
        <label
          label={application.name}
          maxWidthChars={12}
          ellipsize={Pango.EllipsizeMode.END}
          justify={Gtk.Justification.CENTER}
        />
      </box>
    </button>
  )
  return (
    <scrolledwindow
      class="launcher-grid"
      hscrollbarPolicy={Gtk.PolicyType.NEVER}
      propagateNaturalHeight
      maxContentHeight={560}
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <For each={rows}>
          {(row) => (
            <box spacing={8} homogeneous halign={Gtk.Align.START}>
              {row.map(cell)}
            </box>
          )}
        </For>
      </box>
    </scrolledwindow>
  )
}

/**
 * Spotlight and Launchpad in one window: type to search apps, Settings, math, the web, or ask
 * the assistant. Opened empty from the Dock it shows the app grid.
 */
export default function Launcher() {
  const [query, setQuery] = createState("")
  const [selected, setSelected] = createState(0)
  let entry: Gtk.Entry | null = null

  const results = createComputed(() =>
    buildResults(query(), appList().map(toSearchable), {
      assistantName: config().assistant.name,
      assistant: config().assistant.enabled,
    }).slice(0, MAX_RESULTS),
  )
  const view = createComputed(() =>
    query().trim().length > 0 ? "results" : launcherMode() === "grid" ? "grid" : "empty",
  )

  const move = (delta: number) => {
    const count = results.peek().length
    if (count > 0) setSelected((i) => (i + delta + count) % count)
  }

  const onShow = () => {
    setQuery("")
    setSelected(0)
    if (entry) {
      entry.text = ""
      entry.grab_focus()
    }
  }

  return (
    <PopupWindow
      name="launcher"
      namespace="helixos-launcher"
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.START}
      marginTop={140}
      dim={launcherMode.as((m) => m === "grid")}
      onShow={onShow}
      onKeyPressed={(keyval) => {
        if (keyval === Gdk.KEY_Down) {
          move(1)
          return true
        }
        if (keyval === Gdk.KEY_Up) {
          move(-1)
          return true
        }
        return false
      }}
    >
      <box
        class={view.as((v) => `launcher panel view-${v}`)}
        orientation={Gtk.Orientation.VERTICAL}
      >
        <box class="launcher-search" spacing={10}>
          <image iconName="system-search-symbolic" pixelSize={22} />
          <entry
            $={(self) => (entry = self)}
            hexpand
            placeholderText={config.as((c) => `Search or ask ${c.assistant.name}`)}
            onNotifyText={(self) => {
              setQuery(self.text)
              setSelected(0)
            }}
            onActivate={() => {
              const result = results.peek()[selected.peek()]
              if (result) activateResult(result)
            }}
          />
        </box>
        <With value={view}>
          {(current) =>
            current === "grid" ? (
              <AppGrid />
            ) : current === "results" ? (
              <box class="launcher-results" orientation={Gtk.Orientation.VERTICAL}>
                <For each={results} id={(r) => r.id}>
                  {(result, index) => (
                    <ResultRow
                      result={result}
                      index={index.peek()}
                      selected={createComputed(() => selected() === index())}
                      select={() => setSelected(index.peek())}
                    />
                  )}
                </For>
              </box>
            ) : (
              <box visible={false} />
            )
          }
        </With>
      </box>
    </PopupWindow>
  )
}
