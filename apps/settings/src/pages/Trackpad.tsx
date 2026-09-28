import { useCommand } from "@helixos/sdk/react"
import { Callout, Group, Page, Row, Value } from "@helixos/ui"
import { ActionError, LoadError } from "../components/common"
import { HyprSlider, HyprToggle, useHyprOptions } from "../components/HyprOptions"

export function TrackpadPage() {
  const options = useHyprOptions()
  const session = useCommand("session_info")
  // Nested in a window on the host desktop: the host compositor owns the touchpad, so per-
  // device settings here never reach it (they still apply once installed, or from a console).
  const nested = session.data?.kind === "live_nested"
  if (options.loadError)
    return (
      <Page>
        <LoadError error={options.loadError} />
      </Page>
    )
  return (
    <Page>
      {nested && (
        <Callout tone="info">
          The preview is running in a window, so your host desktop is reading the trackpad — these
          settings won’t change anything here. They work once HelixOS is installed, or if you switch
          to a text console and run the preview full screen.
        </Callout>
      )}
      <Group title="Point & Click">
        <HyprSlider
          options={options}
          option="input:sensitivity"
          label="Tracking speed"
          min={-1}
          max={1}
          step={0.05}
          start="Slow"
          end="Fast"
          disabled={nested}
        />
        <HyprToggle
          options={options}
          option="input:touchpad:tap-to-click"
          label="Tap to click"
          description="Tap with one finger."
          disabled={nested}
        />
        <HyprToggle
          options={options}
          option="input:touchpad:clickfinger_behavior"
          label="Two-finger secondary click"
          description="Click with two fingers to open menus, three for a middle click."
          disabled={nested}
        />
        <HyprToggle
          options={options}
          option="input:touchpad:drag_lock"
          label="Drag lock"
          description="Lift a finger mid-drag without dropping."
          disabled={nested}
        />
        <HyprToggle
          options={options}
          option="input:touchpad:disable_while_typing"
          label="Ignore the trackpad while typing"
          disabled={nested}
        />
      </Group>
      <Group title="Scroll & Gestures">
        <HyprToggle
          options={options}
          option="input:touchpad:natural_scroll"
          label="Natural scrolling"
          description="Content follows your fingers."
          disabled={nested}
        />
        <HyprSlider
          options={options}
          option="input:touchpad:scroll_factor"
          label="Scroll speed"
          min={0.2}
          max={2}
          step={0.05}
          start="Slow"
          end="Fast"
          disabled={nested}
        />
        <Row label="Swipe between desktops">
          <Value>Three fingers left or right</Value>
        </Row>
        <Row label="Mission Control">
          <Value>Ctrl ↑</Value>
        </Row>
      </Group>
      <ActionError error={options.error} />
      <Group title="Mouse">
        <HyprToggle
          options={options}
          option="input:natural_scroll"
          label="Natural scrolling for mice"
          disabled={nested}
        />
      </Group>
    </Page>
  )
}
