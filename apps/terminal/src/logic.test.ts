import { describe, expect, it } from "vitest"
import { assessCommand, cleanCommand, lastLines, tabTitle } from "./logic"

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
