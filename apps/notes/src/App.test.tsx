import { setMockBackend } from "@newos/sdk"
import { createMockBackend } from "@newos/sdk/mock"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { App } from "./App"

describe("Notes", () => {
  beforeEach(() => setMockBackend(createMockBackend({ latencyMs: 0 })))
  afterEach(cleanup)

  /** The note list, not the editor (which also shows the open note's title). */
  const list = () => within(screen.getByRole("list"))

  it("lists notes and filters by folder", async () => {
    render(<App />)
    expect(await list().findByText("Groceries")).toBeTruthy()
    expect(list().getByText("Q4 plan")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /^Work/ }))
    await waitFor(() => expect(list().queryByText("Groceries")).toBeNull())
    expect(list().getByText("Q4 plan")).toBeTruthy()
  })

  it("creates a note", async () => {
    render(<App />)
    await list().findByText("Groceries")
    fireEvent.click(screen.getByRole("button", { name: "New note" }))
    expect(await list().findByText("New Note")).toBeTruthy()
  })

  it("searches", async () => {
    render(<App />)
    await list().findByText("Groceries")
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "installer" } })
    await waitFor(() => expect(list().queryByText("Groceries")).toBeNull())
    expect(list().getByText("Q4 plan")).toBeTruthy()
  })
})
