import type { FileEntry } from "@helixos/sdk"
import { describe, expect, it } from "vitest"
import {
  breadcrumbs,
  formatSize,
  parentPath,
  parseNaturalQuery,
  rangeSelect,
  searchFromAssistant,
  sortEntries,
} from "./logic"

const file = (
  name: string,
  kind: FileEntry["kind"],
  size: number,
  modified: number,
): FileEntry => ({
  name,
  path: `/h/${name}`,
  kind,
  size,
  modified,
  hidden: false,
  symlink: false,
})

describe("formatting", () => {
  it("formats sizes like Finder (decimal units)", () => {
    expect(formatSize(512, "other")).toBe("512 bytes")
    expect(formatSize(482_113, "pdf")).toBe("482 KB")
    expect(formatSize(1_234_567_890, "archive")).toBe("1.2 GB")
    expect(formatSize(3, "folder")).toBe("3 items")
    expect(formatSize(null, "other")).toBe("—")
  })
})

describe("sorting and paths", () => {
  const entries = [
    file("b 10.txt", "text", 5, 3),
    file("b 2.txt", "text", 50, 1),
    file("Zed", "folder", 2, 2),
  ]
  it("keeps folders first and sorts naturally", () => {
    expect(sortEntries(entries, "name", true).map((e) => e.name)).toEqual([
      "Zed",
      "b 2.txt",
      "b 10.txt",
    ])
    expect(sortEntries(entries, "size", false).map((e) => e.name)).toEqual([
      "Zed",
      "b 2.txt",
      "b 10.txt",
    ])
    expect(sortEntries(entries, "modified", false).map((e) => e.name)).toEqual([
      "Zed",
      "b 10.txt",
      "b 2.txt",
    ])
  })

  it("builds breadcrumbs and parents", () => {
    expect(breadcrumbs("/home/a/Documents/Work", "/home/a").map((c) => c.name)).toEqual([
      "Home",
      "Documents",
      "Work",
    ])
    expect(breadcrumbs("/run/media/a/USB", "/home/a").map((c) => c.path)).toEqual([
      "/",
      "/run",
      "/run/media",
      "/run/media/a",
      "/run/media/a/USB",
    ])
    expect(parentPath("/home/a/Documents")).toBe("/home/a")
    expect(parentPath("/home")).toBe("/")
  })

  it("selects ranges", () => {
    expect(rangeSelect(["a", "b", "c", "d"], "b", "d")).toEqual(["b", "c", "d"])
    expect(rangeSelect(["a", "b", "c"], "c", "a")).toEqual(["a", "b", "c"])
    expect(rangeSelect(["a", "b"], null, "b")).toEqual(["b"])
  })
})

describe("plain-language search", () => {
  const now = new Date(2026, 8, 26, 12) // Saturday, September 26, 2026
  it("understands kinds, months, and relative dates", () => {
    const q = parseNaturalQuery("the pdf about taxes from March", now)
    expect(q.kinds).toEqual(["pdf"])
    expect(q.words).toEqual(["taxes"])
    expect(new Date(q.modified_after!).getMonth()).toBe(2)
    expect(new Date(q.modified_before!).getMonth()).toBe(3)
    const photos = parseNaturalQuery("photos from last week", now)
    expect(photos.kinds).toEqual(["image"])
    expect(photos.words).toEqual([])
    expect(new Date(photos.modified_after!).getDate()).toBe(14)
    // A later month means last year.
    expect(new Date(parseNaturalQuery("november", now).modified_after!).getFullYear()).toBe(2025)
  })

  it("reads the assistant's structured reply", () => {
    const fallback = parseNaturalQuery("that thing", now)
    const q = searchFromAssistant(
      '{"keywords": "invoice acme", "kind": "pdf", "after": "2026-03-01", "before": null}',
      fallback,
    )
    expect(q.words).toEqual(["invoice", "acme"])
    expect(q.kinds).toEqual(["pdf"])
    expect(new Date(q.modified_after!).getUTCMonth()).toBe(2)
    expect(searchFromAssistant("sorry, no idea", fallback)).toBe(fallback)
    expect(
      searchFromAssistant('{"kind": "spaceship", "after": "not a date"}', fallback).kinds,
    ).toEqual([])
  })
})
