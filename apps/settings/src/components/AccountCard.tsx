import { useCommand } from "@helixos/sdk/react"
import { cx } from "@helixos/ui"

/** The account at the top of the sidebar, like the Apple Account row. Opens Users & Spaces. */
export function AccountCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  const { data: account } = useCommand("account")
  const name = account?.full_name ?? "…"
  return (
    <button
      type="button"
      className={cx("settings-account", selected && "settings-account--selected")}
      onClick={onSelect}
    >
      <span className="settings-avatar" aria-hidden="true">
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="settings-account__text">
        <span className="settings-account__name">{name}</span>
        <span className="settings-account__detail">This Space</span>
      </span>
    </button>
  )
}
