import { listen } from "@helixos/sdk"
import { useAppTheme, useCommand } from "@helixos/sdk/react"
import { SearchField, Sidebar, SidebarItem, SidebarSection, Toolbar, Window } from "@helixos/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AccountCard } from "./components/AccountCard"
import { DEFAULT_PAGE, findPage, PageIcon, PAGES, SECTIONS, searchPages } from "./pages"

/** Emitted by the backend when `helixos-settings --page <id>` runs while Settings is open. */
export const OPEN_PAGE_EVENT = "helixos://open-page"

function initialPage(): string {
  const requested = new URLSearchParams(window.location.search).get("page")
  return findPage(requested)?.page ?? DEFAULT_PAGE
}

/** Back/forward history like System Settings. */
function useHistory(start: string) {
  const [state, setState] = useState({ stack: [start], index: 0 })
  const current = state.stack[state.index]!
  const go = useCallback((page: string) => {
    setState((s) => {
      if (s.stack[s.index] === page) return s
      const stack = [...s.stack.slice(0, s.index + 1), page]
      return { stack, index: stack.length - 1 }
    })
  }, [])
  const back = state.index > 0 ? () => setState((s) => ({ ...s, index: s.index - 1 })) : undefined
  const forward =
    state.index < state.stack.length - 1
      ? () => setState((s) => ({ ...s, index: s.index + 1 }))
      : undefined
  return { current, go, back, forward }
}

export function App() {
  useAppTheme()
  const { current, go, back, forward } = useHistory(initialPage())
  const [query, setQuery] = useState("")
  const wifi = useCommand("wifi_status", undefined, { refreshMs: 10_000 })
  const bluetooth = useCommand("bluetooth_powered", undefined, { refreshMs: 10_000 })

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void listen<string>(OPEN_PAGE_EVENT, (page) => {
      if (findPage(page)) go(page)
    }).then((u) => (unlisten = u))
    return () => unlisten?.()
  }, [go])

  const matches = useMemo(() => new Set(searchPages(query).map((p) => p.page)), [query])
  const page = findPage(current) ?? PAGES[0]!
  const PageComponent = page.component

  const detail = (id: string): string | undefined => {
    if (id === "wifi" && wifi.data)
      return wifi.data.enabled ? (wifi.data.ssid ?? "Not Connected") : "Off"
    if (id === "bluetooth" && bluetooth.data !== undefined) return bluetooth.data ? "On" : "Off"
    return undefined
  }

  const sidebar = (
    <Sidebar header={<SearchField value={query} onChange={setQuery} />}>
      {!query && <AccountCard selected={current === "spaces"} onSelect={() => go("spaces")} />}
      {SECTIONS.map((section, i) => {
        const visible = section.filter((id) => matches.has(id))
        if (visible.length === 0) return null
        return (
          <SidebarSection key={i}>
            {visible.map((id) => {
              const p = findPage(id)!
              return (
                <SidebarItem
                  key={id}
                  label={p.title}
                  icon={<PageIcon page={p} size={20} />}
                  detail={detail(id)}
                  selected={id === current}
                  onSelect={() => go(id)}
                />
              )
            })}
          </SidebarSection>
        )
      })}
      {matches.size === 0 && <div className="settings-no-results">No Results</div>}
    </Sidebar>
  )

  return (
    <Window sidebar={sidebar} sidebarWidth={250}>
      <Toolbar title={page.title} showHistory onBack={back} onForward={forward} />
      {/* key: each page starts fresh (scroll position, open sheets) when you navigate. */}
      <PageComponent key={page.page} />
    </Window>
  )
}
