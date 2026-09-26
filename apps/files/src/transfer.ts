import { call, notify } from "@helixos/sdk"

const baseName = (path: string) => path.replace(/\/+$/, "").split("/").pop() ?? ""

/**
 * Copy or move. The backend shows progress in the Dynamic Island; if the person switched to
 * another app during a long transfer, a notification says when it is done.
 */
export async function transfer(
  sources: string[],
  dest: string,
  moveFiles: boolean,
): Promise<string[]> {
  const started = Date.now()
  const done = await call("files_transfer", { sources, dest, moveFiles })
  if (Date.now() - started > 3000 && !document.hasFocus()) {
    const what =
      sources.length === 1 ? `“${baseName(sources[0] ?? "")}”` : `${sources.length} items`
    notify({
      app_name: "Files",
      icon: "folder",
      summary: `${moveFiles ? "Moved" : "Copied"} ${what}`,
      body: `to ${baseName(dest) || dest}`,
    }).catch(() => {})
  }
  return done
}
