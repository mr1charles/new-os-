#!/usr/bin/env python3
"""NewOS Preview: try NewOS on this computer before installing it.

A small GTK 4 / libadwaita app around scripts/live.sh (testing mode). It sets up the container
the first time, starts and stops NewOS in a window, rebuilds it after updates, and shows the
passwords and shortcuts to use inside. Installed by scripts/install-preview.sh.
"""

import os
import signal
import sys

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, Gio, GLib, Gtk  # noqa: E402

REPO = os.environ.get("NEWOS_REPO") or os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
LIVE = os.path.join(REPO, "scripts", "live.sh")
DATA = os.environ.get("NEWOS_LIVE_DIR") or os.path.join(
    os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "newos-live"
)
ICON = os.path.join(REPO, "preview", "newos-preview.svg")

TIPS = [
    ("Alt+Space", "Ask the assistant"),
    ("Alt+A", "Search apps, files, and settings"),
    ("Alt+Return", "Terminal"),
    ("Alt+E", "Files"),
    ("Alt+,", "Settings"),
    ("Alt+L", "Lock the screen (password: newos)"),
]
SPACES = [
    ("newos", "Unlocks this space"),
    ("work-demo", "The “Work” demo space"),
    ("home-demo", "The “Personal” demo space"),
]


def container_ready() -> bool:
    return os.access(os.path.join(DATA, "root", "usr", "bin", "bash"), os.X_OK)


class Preview(Adw.ApplicationWindow):
    def __init__(self, app: Adw.Application):
        super().__init__(application=app, title="NewOS Preview", default_width=560, default_height=720)
        self.task: Gio.Subprocess | None = None  # create/update/remove
        self.session: Gio.Subprocess | None = None  # NewOS itself
        self.task_name = ""

        toolbar = Adw.ToolbarView()
        header = Adw.HeaderBar()
        toolbar.add_top_bar(header)
        self.toast = Adw.ToastOverlay()
        toolbar.set_content(self.toast)
        self.set_content(toolbar)

        scroller = Gtk.ScrolledWindow(vexpand=True, hscrollbar_policy=Gtk.PolicyType.NEVER)
        self.toast.set_child(scroller)
        clamp = Adw.Clamp(maximum_size=520, margin_top=12, margin_bottom=24, margin_start=16, margin_end=16)
        scroller.set_child(clamp)
        column = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
        clamp.set_child(column)

        # A plain header (Adw.StatusPage scrolls on its own and clips inside this scroller).
        header_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8, margin_top=8)
        icon = Gtk.Image(pixel_size=112)
        if os.path.exists(ICON):
            icon.set_from_file(ICON)
        else:
            icon.set_from_icon_name("computer-symbolic")
        header_box.append(icon)
        self.title_label = Gtk.Label(css_classes=["title-1"], wrap=True, justify=Gtk.Justification.CENTER)
        self.description_label = Gtk.Label(
            css_classes=["body", "dim-label"], wrap=True, justify=Gtk.Justification.CENTER, max_width_chars=52
        )
        header_box.append(self.title_label)
        header_box.append(self.description_label)
        column.append(header_box)

        buttons = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, halign=Gtk.Align.CENTER)
        self.primary = Gtk.Button(label="", css_classes=["pill", "suggested-action"], width_request=240)
        self.primary.connect("clicked", self.on_primary)
        buttons.append(self.primary)
        self.secondary = Gtk.Button(label="Update NewOS", css_classes=["pill"], width_request=240)
        self.secondary.connect("clicked", lambda *_: self.run_task("update", "Updating NewOS…"))
        buttons.append(self.secondary)
        self.progress = Gtk.ProgressBar(visible=False, width_request=240, pulse_step=0.08)
        buttons.append(self.progress)
        column.append(buttons)

        tips = Adw.PreferencesGroup(
            title="Inside NewOS",
            description="NewOS opens in a window. The host keeps the Super key, so NewOS uses Alt instead.",
        )
        for keys, what in TIPS:
            row = Adw.ActionRow(title=what)
            row.add_suffix(Gtk.Label(label=keys, css_classes=["dim-label", "monospace"]))
            tips.add(row)
        column.append(tips)

        spaces = Adw.PreferencesGroup(
            title="Passwords for trying Dual Space",
            description="Each password opens a different space. They only exist inside the preview.",
        )
        for password, what in SPACES:
            row = Adw.ActionRow(title=what)
            row.add_suffix(Gtk.Label(label=password, css_classes=["monospace"], selectable=True))
            spaces.add(row)
        column.append(spaces)

        manage = Adw.PreferencesGroup(title="Preview")
        where = Adw.ActionRow(title="Stored in", subtitle=DATA)
        where.set_subtitle_selectable(True)
        manage.add(where)
        self.remove_row = Adw.ActionRow(
            title="Remove the Preview", subtitle="Deletes the container and everything saved inside it."
        )
        remove = Gtk.Button(label="Remove…", valign=Gtk.Align.CENTER, css_classes=["destructive-action"])
        remove.connect("clicked", self.on_remove)
        self.remove_row.add_suffix(remove)
        manage.add(self.remove_row)
        column.append(manage)

        self.log_view = Gtk.TextView(editable=False, monospace=True, wrap_mode=Gtk.WrapMode.WORD_CHAR, cursor_visible=False)
        self.log_view.set_size_request(-1, 220)
        log_scroll = Gtk.ScrolledWindow(child=self.log_view, min_content_height=220)
        log_scroll.add_css_class("card")
        self.log_expander = Gtk.Expander(label="Details", child=log_scroll)
        column.append(self.log_expander)

        self.connect("close-request", self.on_close)
        self.refresh()

    # -- state ---------------------------------------------------------------------------------

    def refresh(self):
        busy = self.task is not None
        running = self.session is not None
        ready = container_ready()
        if busy:
            self.title_label.set_label(self.task_name)
            self.description_label.set_label("This can take a while the first time. You can keep using your computer.")
        elif running:
            self.title_label.set_label("NewOS is running")
            self.description_label.set_label("It’s open in its own window. Close that window or press Stop to end it.")
        elif ready:
            self.title_label.set_label("NewOS Preview")
            self.description_label.set_label("The whole NewOS desktop in a window, using this laptop’s Wi-Fi, sound, and Bluetooth. Nothing on your system changes.")
        else:
            self.title_label.set_label("Set Up the Preview")
            self.description_label.set_label(
                "The first time, the preview downloads about 3 GB and builds NewOS. It takes 20–30 minutes and needs no administrator password."
            )
        self.primary.set_label("Stop NewOS" if running else "Start NewOS" if ready else "Set Up")
        self.primary.set_css_classes(["pill", "destructive-action" if running else "suggested-action"])
        self.primary.set_sensitive(not busy)
        self.secondary.set_visible(ready and not running)
        self.secondary.set_sensitive(not busy)
        self.remove_row.set_sensitive(ready and not busy and not running)
        self.progress.set_visible(busy)

    def log(self, text: str):
        buffer = self.log_view.get_buffer()
        buffer.insert(buffer.get_end_iter(), text)
        mark = buffer.create_mark(None, buffer.get_end_iter(), False)
        self.log_view.scroll_mark_onscreen(mark)

    # -- actions -------------------------------------------------------------------------------

    def on_primary(self, *_):
        if self.session:
            self.session.send_signal(signal.SIGTERM)
        elif container_ready():
            self.start()
        else:
            self.run_task("create", "Setting up the preview…")

    def spawn(self, args: list[str], stdin: bool = False) -> Gio.Subprocess:
        flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE
        if stdin:
            flags |= Gio.SubprocessFlags.STDIN_PIPE
        return Gio.Subprocess.new([LIVE, *args], flags)

    def follow(self, process: Gio.Subprocess, on_line):
        stream = Gio.DataInputStream.new(process.get_stdout_pipe())

        def read(source, result):
            try:
                line, _ = source.read_line_finish_utf8(result)
            except GLib.Error:
                line = None
            if line is None:
                return
            on_line(line)
            source.read_line_async(GLib.PRIORITY_DEFAULT, None, read)

        stream.read_line_async(GLib.PRIORITY_DEFAULT, None, read)

    def run_task(self, command: str, title: str, stdin_text: str | None = None):
        try:
            self.task = self.spawn([command], stdin=stdin_text is not None)
        except GLib.Error as error:
            self.toast.add_toast(Adw.Toast(title=f"Couldn’t start: {error.message}"))
            return
        self.task_name = title
        self.log(f"\n$ live.sh {command}\n")
        if stdin_text is not None:
            self.task.communicate_utf8_async(stdin_text, None, None)
        pulse = GLib.timeout_add(150, lambda: (self.progress.pulse(), True)[1])

        def on_line(line: str):
            clean = line.replace("\x1b[1m", "").replace("\x1b[0m", "").rstrip("\r")
            self.log(clean + "\n")
            if clean.startswith("==> "):
                self.description_label.set_label(clean[4:])

        if stdin_text is None:
            self.follow(self.task, on_line)

        def done(process, result):
            GLib.source_remove(pulse)
            try:
                ok = process.wait_check_finish(result)
            except GLib.Error:
                ok = False
            self.task = None
            self.toast.add_toast(Adw.Toast(title=f"{title.rstrip('…')}: {'done' if ok else 'failed, see Details'}"))
            if not ok:
                self.log_expander.set_expanded(True)
            self.refresh()

        self.task.wait_check_async(None, done)
        self.refresh()

    def start(self):
        try:
            self.session = self.spawn(["run"])
        except GLib.Error as error:
            self.toast.add_toast(Adw.Toast(title=f"Couldn’t start NewOS: {error.message}"))
            return
        self.log("\n$ live.sh run\n")
        self.follow(self.session, lambda line: self.log(line + "\n"))

        def ended(process, result):
            try:
                process.wait_finish(result)
            except GLib.Error:
                pass
            self.session = None
            self.refresh()

        self.session.wait_async(None, ended)
        self.refresh()

    def on_remove(self, *_):
        dialog = Adw.AlertDialog(
            heading="Remove the Preview?",
            body="The container, the NewOS build inside it, and everything saved in the preview will be deleted. Your own files are not touched.",
        )
        dialog.add_response("cancel", "Cancel")
        dialog.add_response("remove", "Remove")
        dialog.set_response_appearance("remove", Adw.ResponseAppearance.DESTRUCTIVE)

        def chosen(dialog, result):
            if dialog.choose_finish(result) == "remove":
                self.run_task("remove", "Removing the preview…", stdin_text="y\n")

        dialog.choose(self, None, chosen)

    def on_close(self, *_):
        if self.session:
            self.session.send_signal(signal.SIGTERM)
        return False


class App(Adw.Application):
    def __init__(self):
        super().__init__(application_id="org.newos.Preview", flags=Gio.ApplicationFlags.DEFAULT_FLAGS)

    def do_activate(self):
        window = self.get_active_window() or Preview(self)
        window.present()


if __name__ == "__main__":
    if not os.access(LIVE, os.X_OK):
        print(f"newos-preview: {LIVE} not found; set NEWOS_REPO to the NewOS checkout", file=sys.stderr)
        sys.exit(1)
    sys.exit(App().run(sys.argv))
