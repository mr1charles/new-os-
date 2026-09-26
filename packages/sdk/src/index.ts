export * from "./commands"
export * from "./ipc"
export * from "./settings"
export * from "./assistant"
export * from "./theme"
export * from "./terminal"
export * from "./island"
export * from "./customize"
export {
  DEFAULT_CONFIG as DEFAULT_SETTINGS,
  resolveTheme,
  type ThemePreference,
  type AnimationLevel,
  type BarPosition,
  type DockPosition,
  type DockStyle,
  type WindowControls,
  type WindowLayout,
  type Theme,
} from "./settings-schema"
