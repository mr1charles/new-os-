import { setMockBackend } from "@newos/sdk"
import { createMockBackend } from "@newos/sdk/mock"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { App } from "./App"

describe("Files", () => {
  beforeEach(() => setMockBackend(createMockBackend({ latencyMs: 0 })))
  afterEach(cleanup)

  const openPlace = async (name: string) => {
    fireEvent.click(await screen.findByRole("button", { name }))
  }

  it("browses folders and hides dotfiles", async () => {
    render(<App />)
    expect(await screen.findByText("Documents", { selector: "td span" })).toBeTruthy()
    expect(screen.queryByText(".bashrc")).toBeNull()
    await openPlace("Documents")
    expect(await screen.findByText("Taxes 2026.pdf")).toBeTruthy()
    fireEvent.doubleClick(screen.getByText("Work"))
    expect(await screen.findByText("Q4 plan.md")).toBeTruthy()
  })

  it("moves files to the Trash and puts them back", async () => {
    render(<App />)
    await openPlace("Documents")
    fireEvent.click(await screen.findByText("Budget.xlsx"))
    fireEvent.keyDown(screen.getByRole("grid"), { key: "Delete" })
    await waitFor(() => expect(screen.queryByText("Budget.xlsx")).toBeNull())
    await openPlace("Trash")
    fireEvent.click(await screen.findByRole("button", { name: "Put Back" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Put Back" })).toBeNull())
  })

  it("searches in plain language", async () => {
    render(<App />)
    await screen.findByText("Documents", { selector: "td span" })
    const box = screen.getByRole("searchbox")
    fireEvent.change(box, { target: { value: "pictures" } })
    fireEvent.submit(box.closest("form")!)
    expect(await screen.findByText("Beach.jpg")).toBeTruthy()
    expect(screen.queryByText("Taxes 2026.pdf")).toBeNull()
  })
})
