import { useCommand } from "@newos/sdk/react"
import { Group, Page, Row, Value } from "@newos/ui"
import { LoadError } from "../components/common"
import { cleanCpuName, cleanGpuName, formatBytes, formatMemory } from "../format"

export const NEWOS_VERSION = "0.1.0"

export function AboutPage() {
  const about = useCommand("about")
  if (about.error)
    return (
      <Page>
        <LoadError error={about.error} retry={() => void about.reload()} />
      </Page>
    )
  const a = about.data
  const used = a ? a.disk_total_bytes - a.disk_free_bytes : 0
  const usedFraction = a && a.disk_total_bytes > 0 ? used / a.disk_total_bytes : 0
  return (
    <Page>
      <div className="settings-about-hero">
        <div className="settings-about-logo" aria-hidden="true" />
        <h2 className="settings-about-model">{a?.model || "This Computer"}</h2>
        <p className="settings-about-os">NewOS {NEWOS_VERSION}</p>
      </div>
      {a && (
        <>
          <Group>
            <Row label="Processor">
              <Value>
                {cleanCpuName(a.cpu)} ({a.cpu_cores} threads)
              </Value>
            </Row>
            <Row label="Memory">
              <Value>{formatMemory(a.memory_bytes)}</Value>
            </Row>
            {a.graphics.map((g, i) => (
              <Row key={g} label={i === 0 ? "Graphics" : ""}>
                <Value>{cleanGpuName(g)}</Value>
              </Row>
            ))}
            {a.sku && (
              <Row label="Product number">
                <Value>{a.sku}</Value>
              </Row>
            )}
            <Row label="Firmware">
              <Value>{a.firmware || "—"}</Value>
            </Row>
          </Group>
          <Group title="Storage">
            <Row label="Startup disk" stacked>
              <div className="settings-storage">
                <div
                  className="settings-storage__bar"
                  role="meter"
                  aria-valuenow={Math.round(usedFraction * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Disk used"
                >
                  <span style={{ width: `${Math.round(usedFraction * 1000) / 10}%` }} />
                </div>
                <span className="settings-storage__text">
                  {formatBytes(a.disk_free_bytes)} available of {formatBytes(a.disk_total_bytes)}
                </span>
              </div>
            </Row>
          </Group>
          <Group title="Software">
            <Row label="Computer name">
              <Value>{a.hostname}</Value>
            </Row>
            <Row label="Base system">
              <Value>{a.base_os}</Value>
            </Row>
            <Row label="Linux kernel">
              <Value>{a.kernel}</Value>
            </Row>
          </Group>
        </>
      )}
    </Page>
  )
}
