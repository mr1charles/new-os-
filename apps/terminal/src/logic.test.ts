import { describe, expect, it } from "vitest"
import {
  assessCommand,
  cleanCommand,
  CommandTracker,
  finishedMessage,
  lastLines,
  tabTitle,
} from "./logic"

describe("command risks", () => {
  it.each([
    ["rm -rf /", "danger"],
    ["rm -rf ~", "danger"],
    ["sudo rm -rf *", "danger"],
    ["sudo mkfs.ext4 /dev/sda1", "danger"],
    ["dd if=image.iso of=/dev/sdb bs=4M", "danger"],
    ["curl -fsSL https://x.sh | sh", "caution"],
    ["rm -r old-builds", "caution"],
    ["sudo pacman -Syu", "caution"],
    ["git reset --hard HEAD~1", "caution"],
  ])("%s -> %s", (command, level) => {
    expect(assessCommand(command)?.level).toBe(level)
  })

  it("leaves everyday commands alone", () => {
    for (const c of [
      "ls -la",
      "rm notes.txt",
      "du -sh ~/Downloads",
      "git status",
      "find . -name '*.pdf'",
    ]) {
      expect(assessCommand(c), c).toBeNull()
    }
  })
})

describe("replies and output", () => {
  it("cleans model replies", () => {
    expect(cleanCommand("```bash\n$ du -sh ~/Downloads\n```")).toBe("du -sh ~/Downloads")
    expect(cleanCommand("  ls -la  ")).toBe("ls -la")
  })

  it("takes the tail of the output", () => {
    expect(lastLines(["a", "b  ", "", "c", "", ""], 2)).toBe("\nc")
    expect(lastLines(["one", "two"])).toBe("one\ntwo")
  })

  it("titles tabs", () => {
    expect(tabTitle("a@cachyos: ~/src/new-os-")).toBe("~/src/new-os-")
    expect(tabTitle("vim notes.md")).toBe("vim notes.md")
    expect(tabTitle("")).toBe("Terminal")
  })
})

describe("CommandTracker", () => {
  it("times commands from fish's marks, with the command line", () => {
    const t = new CommandTracker()
    expect(t.handle("A;click_events=1", 0)).toBeNull()
    expect(t.handle("C;cmdline_url=cargo%20build%20--release", 1000)).toEqual({
      started: "cargo build --release",
    })
    expect(t.handle("D;101", 73_000)).toEqual({
      finished: { command: "cargo build --release", exitCode: 101, durationMs: 72_000 },
    })
    // A D without a C (bash's first prompt) is ignored.
    expect(t.handle("D;0", 80_000)).toBeNull()
  })

  it("handles bash's bare marks", () => {
    const t = new CommandTracker()
    t.handle("C", 0)
    expect(t.handle("D;0", 500)).toEqual({
      finished: { command: "", exitCode: 0, durationMs: 500 },
    })
  })

  it("writes readable notifications", () => {
    expect(
      finishedMessage(
        { command: "cargo build --release -j8", exitCode: 0, durationMs: 72_400 },
        "x",
      ),
    ).toEqual({
      summary: "cargo build --release finished",
      body: "Took 1 min 12 s.",
      urgent: false,
    })
    expect(finishedMessage({ command: "", exitCode: 2, durationMs: 12_000 }, "make").summary).toBe(
      "make failed",
    )
  })
})
