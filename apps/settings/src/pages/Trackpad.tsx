import { Group, Page, Row, Value } from "@newos/ui"
import { ActionError, LoadError } from "../components/common"
import { HyprSlider, HyprToggle, useHyprOptions } from "../components/HyprOptions"

export function TrackpadPage() {
  const options = useHyprOptions()
  if (options.loadError)
    return (
      <Page>
        <LoadError error={options.loadError} />
      </Page>
    )
  return (
    <Page>
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
        />
        <HyprToggle
          options={options}
          option="input:touchpad:tap-to-click"
          label="Tap to click"
          description="Tap with one finger."
        />
        <HyprToggle
          options={options}
          option="input:touchpad:clickfinger_behavior"
          label="Two-finger secondary click"
          description="Click with two fingers to open menus, three for a middle click."
        />
        <HyprToggle
          options={options}
          option="input:touchpad:drag_lock"
          label="Drag lock"
          description="Lift a finger mid-drag without dropping."
        />
        <HyprToggle
          options={options}
          option="input:touchpad:disable_while_typing"
          label="Ignore the trackpad while typing"
        />
      </Group>
      <Group title="Scroll & Gestures">
        <HyprToggle
          options={options}
          option="input:touchpad:natural_scroll"
          label="Natural scrolling"
          description="Content follows your fingers."
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
        />
      </Group>
    </Page>
  )
}
