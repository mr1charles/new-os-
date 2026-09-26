/**
 * Checks for an app's backend commands, used by each app's `backend.test.ts` (Node only).
 * Apps call commands by name, so a typo or a missing handler only fails at runtime; these
 * keep the app's calls, its Rust handlers, the SDK's types, and the mock in step.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(path, "utf8")

/** The repository root, from an app's directory (apps/<name>). */
const repo = (appDir: string) => join(appDir, "..", "..")

/** Keys of `export interface Commands { ... }` in the SDK. */
export function sdkCommands(appDir: string): string[] {
  const source = read(join(repo(appDir), "packages/sdk/src/commands.ts"))
  const body = source.slice(source.indexOf("export interface Commands {"))
  const block = body.slice(0, body.indexOf("\n}\n"))
  return [...block.matchAll(/^ {2}(\w+): \[/gm)].map((m) => m[1]!)
}

/** Streaming commands take a channel, so they go through callStreaming instead of Commands. */
export const STREAMING_COMMANDS = ["assistant_stream"]

/** Commands every app gets from newos-appkit (`COMMANDS` in tauri_app.rs). */
export function sharedCommands(appDir: string): string[] {
  const source = read(join(repo(appDir), "services/appkit/src/tauri_app.rs"))
  const start = source.indexOf("pub const COMMANDS")
  const block = source.slice(start, source.indexOf("];", start))
  return [...block.matchAll(/"(\w+)"/g)].map((m) => m[1]!)
}

/** The app's own handlers: `commands::name` inside `generate_handler![...]` in main.rs. */
export function appCommands(appDir: string): string[] {
  const source = read(join(appDir, "src-tauri/src/main.rs"))
  const start = source.indexOf("generate_handler![")
  const block = source.slice(start, source.indexOf("]", start))
  return [...block.matchAll(/commands::(\w+)/g)].map((m) => m[1]!)
}

export function registeredCommands(appDir: string): string[] {
  return [...sharedCommands(appDir), ...appCommands(appDir)]
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/**
 * Commands the app's frontend calls directly: `call("x"`, `useCommand("x"`, and
 * `callStreaming("x"`. Calls through `assistant.*` and `settings` use shared commands.
 */
export function calledCommands(appDir: string): string[] {
  const names = new Set<string>()
  for (const file of sourceFiles(join(appDir, "src"))) {
    for (const m of read(file).matchAll(/\b(?:call|useCommand|callStreaming)\(\s*"(\w+)"/g))
      names.add(m[1]!)
  }
  return [...names].sort()
}

/** Rust functions defined as `pub fn name(` / `pub async fn name(` in commands.rs. */
export function definedRustCommands(appDir: string): string[] {
  const source = read(join(appDir, "src-tauri/src/commands.rs"))
  return [...source.matchAll(/pub (?:async )?fn (\w+)\(/g)].map((m) => m[1]!)
}
