import "@newos/design-tokens/dist/tokens.css"
import "@newos/ui/styles.css"
import "./settings.css"

import { inTauri, setMockBackend } from "@newos/sdk"
import { createMockBackend } from "@newos/sdk/mock"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"

// Outside Tauri (plain `pnpm dev` in a browser) the UI runs against sample data.
if (!inTauri()) setMockBackend(createMockBackend())

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
