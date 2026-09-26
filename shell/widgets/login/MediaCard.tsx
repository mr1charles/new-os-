import Gtk from "gi://Gtk?version=4.0"
import Pango from "gi://Pango?version=1.0"
import { createBinding, createComputed, createState, With } from "ags"
import { mpris, AstalMpris } from "../../lib/services"
import { setImageSource } from "../../lib/icons"
import { now } from "../../lib/clock"
import { formatCountdown } from "../../lib/format"

const VERTICAL = Gtk.Orientation.VERTICAL

/** The player to show: the one playing, else the last one paused. */
function pickPlayer(players: AstalMpris.Player[]): AstalMpris.Player | null {
  const live = players.filter((p) => p.available && p.title)
  return (
    live.find((p) => p.playbackStatus === AstalMpris.PlaybackStatus.PLAYING) ??
    live.find((p) => p.playbackStatus === AstalMpris.PlaybackStatus.PAUSED) ??
    null
  )
}

function Player({ player }: { player: AstalMpris.Player }) {
  const title = createBinding(player, "title")
  const artist = createBinding(player, "artist")
  const cover = createBinding(player, "coverArt")
  const status = createBinding(player, "playbackStatus")
  const length = createBinding(player, "length")
  // Position has no change signal worth trusting; read it with the clock.
  const position = now.as(() => player.position)
  const fraction = createComputed(() => (length() > 0 ? Math.min(1, position() / length()) : 0))
  return (
    <box class="lock-media" orientation={VERTICAL} spacing={10} widthRequest={380}>
      <box spacing={12}>
        <image
          class="lock-media-cover"
          pixelSize={52}
          overflow={Gtk.Overflow.HIDDEN}
          $={(self) => {
            setImageSource(self, cover.peek(), "audio-x-generic-symbolic")
            cover.subscribe(() => setImageSource(self, cover.peek(), "audio-x-generic-symbolic"))
          }}
        />
        <box orientation={VERTICAL} valign={Gtk.Align.CENTER} hexpand>
          <label
            class="lock-media-title"
            label={title}
            xalign={0}
            ellipsize={Pango.EllipsizeMode.END}
            maxWidthChars={30}
          />
          <label
            class="lock-media-artist"
            label={artist}
            xalign={0}
            ellipsize={Pango.EllipsizeMode.END}
            maxWidthChars={30}
          />
        </box>
      </box>
      <box spacing={8}>
        <label class="lock-media-time" label={position.as((p) => formatCountdown(p * 1000))} />
        <levelbar class="lock-media-progress" hexpand valign={Gtk.Align.CENTER} value={fraction} />
        <label
          class="lock-media-time"
          label={createComputed(
            () => `-${formatCountdown(Math.max(0, length() - position()) * 1000)}`,
          )}
        />
      </box>
      <box halign={Gtk.Align.CENTER} spacing={28}>
        <button
          class="lock-media-button"
          onClicked={() => player.previous()}
          tooltipText="Previous"
        >
          <image iconName="media-skip-backward-symbolic" pixelSize={20} />
        </button>
        <button
          class="lock-media-button"
          onClicked={() => player.play_pause()}
          tooltipText="Play or Pause"
        >
          <image
            pixelSize={26}
            iconName={status.as((s) =>
              s === AstalMpris.PlaybackStatus.PLAYING
                ? "media-playback-pause-symbolic"
                : "media-playback-start-symbolic",
            )}
          />
        </button>
        <button class="lock-media-button" onClicked={() => player.next()} tooltipText="Next">
          <image iconName="media-skip-forward-symbolic" pixelSize={20} />
        </button>
      </box>
    </box>
  )
}

/** Now Playing on the lock screen, as a glass card. Hidden when nothing plays. */
export default function MediaCard() {
  if (!mpris) return <box visible={false} />
  const players = createBinding(mpris, "players")
  // Re-pick when players come and go, or start and stop.
  const [tick, setTick] = createState(0)
  const chosen = createComputed(() => {
    tick()
    return pickPlayer(players())
  })
  const watched = new WeakSet<AstalMpris.Player>()
  const watch = (list: AstalMpris.Player[]) =>
    list
      .filter((p) => !watched.has(p))
      .forEach((p) => {
        watched.add(p)
        p.connect("notify::playback-status", () => setTick(tick.peek() + 1))
      })
  watch(players.peek())
  players.subscribe(() => watch(players.peek()))
  return (
    <box halign={Gtk.Align.CENTER}>
      <With value={chosen}>{(player) => (player ? <Player player={player} /> : <box />)}</With>
    </box>
  )
}
