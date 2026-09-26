import { accentColor, accentNames } from "@newos/design-tokens"
import { call, type SpaceInfo } from "@newos/sdk"
import { useAction, useCommand } from "@newos/sdk/react"
import {
  Badge,
  Button,
  Callout,
  cx,
  Field,
  Group,
  Page,
  Row,
  Sheet,
  TextField,
  Value,
} from "@newos/ui"
import { Fingerprint, Plus } from "lucide-react"
import { useState } from "react"
import { ActionError } from "../components/common"
import { fingerName } from "../format"

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function AccentPicker({ value, onChange }: { value: string; onChange: (accent: string) => void }) {
  return (
    <div className="settings-swatches" role="radiogroup" aria-label="Accent color">
      {accentNames.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={value === name}
          aria-label={title(name)}
          title={title(name)}
          className={cx("settings-swatch", value === name && "settings-swatch--selected")}
          style={{ background: accentColor(name, "dark") }}
          onClick={() => onChange(name)}
        />
      ))}
    </div>
  )
}

/** A new password, typed twice. `onValid` gets it once both match and it is long enough. */
function PasswordFields({ onChange }: { onChange: (password: string | null) => void }) {
  const [first, setFirst] = useState("")
  const [second, setSecond] = useState("")
  const update = (a: string, b: string) => onChange(a.length >= 6 && a === b ? a : null)
  const hint =
    first && first.length < 6
      ? "At least 6 characters."
      : second && first !== second
        ? "The passwords don’t match."
        : undefined
  return (
    <>
      <Field
        label="Password"
        hint="This password is what opens this space at the login screen. Each space needs a different one."
      >
        {(id) => (
          <TextField
            id={id}
            type="password"
            autoComplete="new-password"
            value={first}
            onChange={(e) => {
              setFirst(e.currentTarget.value)
              update(e.currentTarget.value, second)
            }}
          />
        )}
      </Field>
      <Field label="Confirm password" hint={hint}>
        {(id) => (
          <TextField
            id={id}
            type="password"
            autoComplete="new-password"
            value={second}
            onChange={(e) => {
              setSecond(e.currentTarget.value)
              update(first, e.currentTarget.value)
            }}
          />
        )}
      </Field>
    </>
  )
}

function NewSpaceSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("")
  const [password, setPassword] = useState<string | null>(null)
  const [accent, setAccent] = useState("purple")
  const create = useAction(async () => {
    await call("spaces_create", { name: name.trim(), password: password!, accent })
    onCreated()
    onClose()
  })
  return (
    <Sheet
      open
      onClose={onClose}
      title="New Space"
      width={440}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!name.trim() || !password || create.pending}
            onClick={() => void create.run()}
          >
            {create.pending ? "Creating…" : "Create Space"}
          </Button>
        </>
      }
    >
      <p className="settings-sheet-intro">
        A space is a separate account with its own apps, files, and settings. At the login screen,
        its password opens it.
      </p>
      <Field label="Name">
        {(id) => (
          <TextField
            id={id}
            autoFocus
            placeholder="Work, Personal, School…"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        )}
      </Field>
      <PasswordFields onChange={setPassword} />
      <Field label="Accent color">
        {() => <AccentPicker value={accent} onChange={setAccent} />}
      </Field>
      <ActionError error={create.error} />
      <p className="settings-sheet-note">You’ll be asked for an administrator’s password.</p>
    </Sheet>
  )
}

type Editing = { kind: "rename" | "password" | "delete"; space: SpaceInfo } | null

function EditSheet({
  editing,
  onClose,
  onDone,
}: {
  editing: NonNullable<Editing>
  onClose: () => void
  onDone: () => void
}) {
  const { kind, space } = editing
  const [name, setName] = useState(space.name)
  const [password, setPassword] = useState<string | null>(null)
  const [keepHome, setKeepHome] = useState(true)
  const save = useAction(async () => {
    if (kind === "rename")
      await call("spaces_rename", { account: space.account, name: name.trim() })
    else if (kind === "password")
      await call("spaces_set_password", { account: space.account, password: password! })
    else await call("spaces_delete", { account: space.account, keepHome })
    onDone()
    onClose()
  })
  const ready =
    kind === "rename"
      ? name.trim().length > 0 && name.trim() !== space.name
      : kind === "password"
        ? password !== null
        : true
  return (
    <Sheet
      open
      onClose={onClose}
      title={
        kind === "rename"
          ? `Rename “${space.name}”`
          : kind === "password"
            ? `New Password for “${space.name}”`
            : `Delete “${space.name}”?`
      }
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={kind === "delete" ? "destructive" : "primary"}
            disabled={!ready || save.pending}
            onClick={() => void save.run()}
          >
            {kind === "rename"
              ? "Rename"
              : kind === "password"
                ? "Change Password"
                : "Delete Space"}
          </Button>
        </>
      }
    >
      {kind === "rename" && (
        <Field label="Name">
          {(id) => (
            <TextField
              id={id}
              autoFocus
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          )}
        </Field>
      )}
      {kind === "password" && <PasswordFields onChange={setPassword} />}
      {kind === "delete" && (
        <>
          <p className="settings-sheet-intro">
            The account <code>{space.account}</code> is removed and its password stops working at
            the login screen.
          </p>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={keepHome}
              onChange={(e) => setKeepHome(e.currentTarget.checked)}
            />{" "}
            Keep its files in <code>/home/{space.account}</code>
          </label>
          {!keepHome && (
            <Callout tone="danger">
              Its files, apps’ data, and settings will be deleted for good.
            </Callout>
          )}
        </>
      )}
      <ActionError error={save.error} />
    </Sheet>
  )
}

export function SpacesPage() {
  const account = useCommand("account")
  const prints = useCommand("fingerprints")
  const spaces = useCommand("spaces_list")
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const change = useAction(
    async (kind: "default" | "accent", space: SpaceInfo, accent?: string) => {
      if (kind === "default") await call("spaces_set_default", { account: space.account })
      else await call("spaces_set_accent", { account: space.account, accent: accent! })
      await spaces.reload()
    },
  )
  const a = account.data
  const fp = prints.data
  const list = spaces.data ?? []

  return (
    <Page>
      {a && (
        <Group>
          <Row
            label={
              <span className="settings-account-title">
                {list.find((s) => s.account === a.username)?.name ?? a.full_name}
              </span>
            }
            description={`${a.username} · ${a.home}`}
            icon={
              <span className="settings-avatar settings-avatar--large" aria-hidden="true">
                {a.full_name.charAt(0).toUpperCase()}
              </span>
            }
          >
            {a.admin && <Badge tone="accent">Admin</Badge>}
          </Row>
        </Group>
      )}
      <Group
        title="Spaces"
        titleAccessory={
          <Button size="small" onClick={() => setCreating(true)} disabled={!!spaces.error}>
            <Plus size={12} /> Add Space…
          </Button>
        }
        footer="Each space is a separate account with its own apps, files, and look. At the login screen, the password you type decides which space opens."
      >
        {spaces.error ? (
          <Row label="Spaces aren’t available" description={spaces.error} />
        ) : (
          list.map((space) => (
            <Row
              key={space.account}
              label={space.name}
              description={space.account}
              icon={
                <span
                  className="settings-space-dot"
                  style={{ background: accentColor(space.accent, "dark") }}
                  aria-hidden="true"
                />
              }
            >
              {space.account === a?.username && <Badge tone="success">This Space</Badge>}
              {space.default && <Badge>Default</Badge>}
              <Button size="small" onClick={() => setEditing({ kind: "rename", space })}>
                Rename…
              </Button>
              <Button size="small" onClick={() => setEditing({ kind: "password", space })}>
                Password…
              </Button>
              {!space.default && (
                <Button
                  size="small"
                  onClick={() => void change.run("default", space)}
                  title="Show this space’s look at the login screen"
                >
                  Make Default
                </Button>
              )}
              {space.account !== a?.username && list.length > 1 && (
                <Button
                  size="small"
                  variant="destructive"
                  onClick={() => setEditing({ kind: "delete", space })}
                >
                  Delete…
                </Button>
              )}
            </Row>
          ))
        )}
      </Group>
      <ActionError error={change.error} />
      <Group
        title="Fingerprints"
        footer={
          fp?.available
            ? `Reader: ${fp.device}. Opening a space with a fingerprint comes in the next update; passwords work now.`
            : "No fingerprint reader was found. Spaces work with passwords."
        }
      >
        {fp?.available ? (
          fp.enrolled.length > 0 ? (
            fp.enrolled.map((f) => (
              <Row
                key={f}
                label={fingerName(f)}
                icon={<Fingerprint size={18} className="settings-muted" />}
              >
                <Value>Enrolled</Value>
              </Row>
            ))
          ) : (
            <Row label="No fingerprints enrolled" />
          )
        ) : (
          <Row label={prints.loading ? "Checking for a reader…" : "Not available"} />
        )}
      </Group>
      {creating && (
        <NewSpaceSheet onClose={() => setCreating(false)} onCreated={() => void spaces.reload()} />
      )}
      {editing && (
        <EditSheet
          editing={editing}
          onClose={() => setEditing(null)}
          onDone={() => void spaces.reload()}
        />
      )}
    </Page>
  )
}
