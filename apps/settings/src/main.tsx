import "./settings.css"
import "./setup/setup.css"

import { startApp } from "@helixos/ui/start"
import { App } from "./App"
import { SetupApp } from "./setup/SetupApp"

// `helixos-settings --setup` opens index.html?setup=1: the first-run Setup instead of Settings.
startApp(new URLSearchParams(window.location.search).has("setup") ? SetupApp : App)
