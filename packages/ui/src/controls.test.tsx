import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { SearchField, SegmentedControl, Slider, Toggle } from "./controls"
import { Row } from "./Group"
import { Sheet } from "./Sheet"

describe("Toggle", () => {
  it("is a switch that flips on click", () => {
    function Harness() {
      const [on, setOn] = useState(false)
      return <Toggle checked={on} onChange={setOn} label="Wi-Fi" />
    }
    render(<Harness />)
    const toggle = screen.getByRole("switch", { name: "Wi-Fi" })
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-checked")).toBe("true")
  })
})

describe("Slider", () => {
  it("reports changes and the committed value", () => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    render(<Slider value={0.5} onChange={onChange} onCommit={onCommit} label="Volume" />)
    const input = screen.getByRole("slider", { name: "Volume" })
    fireEvent.change(input, { target: { value: "0.8" } })
    expect(onChange).toHaveBeenCalledWith(0.8)
    fireEvent.pointerUp(input)
    expect(onCommit).toHaveBeenCalled()
  })
})

describe("SegmentedControl", () => {
  it("marks the selected option and reports picks", () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        label="Appearance"
        value="dark"
        onChange={onChange}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />,
    )
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("radio", { name: "Light" }))
    expect(onChange).toHaveBeenCalledWith("light")
  })
})

describe("SearchField", () => {
  it("clears with Escape", () => {
    const onChange = vi.fn()
    render(<SearchField value="wifi" onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" })
    expect(onChange).toHaveBeenCalledWith("")
  })
})

describe("Row", () => {
  it("becomes a button when clickable", () => {
    const onClick = vi.fn()
    render(<Row label="Details" onClick={onClick} />)
    fireEvent.click(screen.getByRole("button", { name: "Details" }))
    expect(onClick).toHaveBeenCalled()
  })
})

describe("Sheet", () => {
  it("renders its content only while open and closes on Escape", () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Sheet open={false} onClose={onClose} title="Join Network">
        <p>password</p>
      </Sheet>,
    )
    expect(screen.queryByText("password")).toBeNull()
    rerender(
      <Sheet open onClose={onClose} title="Join Network">
        <p>password</p>
      </Sheet>,
    )
    expect(screen.getByText("password")).toBeTruthy()
    act(() => {
      fireEvent.keyDown(screen.getByText("password"), { key: "Escape" })
    })
    expect(onClose).toHaveBeenCalled()
  })
})
