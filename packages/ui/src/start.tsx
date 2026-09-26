/**
 * Start an app: load the design tokens and UI styles, use the sample-data backend when the page
 * runs in a plain browser (vite dev without Tauri), and render.
 */
import "@helixos/design-tokens/dist/tokens.css"
import "./styles.css"

import { inTauri, setMockBackend } from "@helixos/sdk"
import { createMockBackend } from "@helixos/sdk/mock"
import { StrictMode, type ComponentType } from "react"
import { createRoot } from "react-dom/client"

export function startApp(App: ComponentType, rootId = "root") {
  if (!inTauri()) setMockBackend(createMockBackend())
  const root = document.getElementById(rootId)
  if (!root) throw new Error(`no #${rootId} element`)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
