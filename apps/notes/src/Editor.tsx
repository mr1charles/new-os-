/**
 * The note editor: CodeMirror 6 with Markdown, larger headings, and checklist boxes you can
 * click. The text stays plain Markdown on disk; styling is only on screen.
 */
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { EditorState, RangeSetBuilder } from "@codemirror/state"
import {
  Decoration,
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view"
import { tags } from "@lezer/highlight"
import { useEffect, useRef } from "react"
import { checkboxMark } from "./logic"

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.6em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.1em", fontWeight: "600" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--helixos-accent)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--helixos-accent)" },
  { tag: tags.monospace, fontFamily: "var(--helixos-font-mono)", fontSize: "0.92em" },
  { tag: tags.quote, color: "var(--helixos-color-fg-secondary)", fontStyle: "italic" },
  { tag: [tags.processingInstruction, tags.meta], color: "var(--helixos-color-fg-tertiary)" },
])

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super()
  }

  override eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos
  }

  toDOM(view: EditorView) {
    const box = document.createElement("input")
    box.type = "checkbox"
    box.checked = this.checked
    box.className = "notes-checkbox"
    box.setAttribute("aria-label", this.checked ? "Done" : "Not done")
    box.addEventListener("mousedown", (e) => e.preventDefault())
    box.addEventListener("click", (e) => {
      e.preventDefault()
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? " " : "x" },
      })
    })
    return box
  }

  override ignoreEvent() {
    return false
  }
}

/** Replace "[ ]" / "[x]" at the start of task lines with a real checkbox, and dim done items. */
function checkboxDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      const mark = checkboxMark(line.text)
      if (mark !== null) {
        // Hide the whole "- [ ]" (bullet and brackets) behind one checkbox.
        const bullet = line.from + mark - 3
        const checked = line.text[mark] !== " "
        builder.add(
          bullet,
          bullet + 5,
          Decoration.replace({ widget: new CheckboxWidget(checked, line.from + mark) }),
        )
        if (checked && bullet + 6 <= line.to) {
          builder.add(bullet + 6, line.to, Decoration.mark({ class: "notes-done" }))
        }
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const checkboxes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = checkboxDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = checkboxDecorations(update.view)
    }
  },
  { decorations: (v) => v.decorations },
)

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "15px", backgroundColor: "transparent" },
  ".cm-scroller": {
    fontFamily: "var(--helixos-font-family)",
    lineHeight: "1.6",
    padding: "8px 0 40px",
  },
  ".cm-content": {
    maxWidth: "720px",
    margin: "0 auto",
    padding: "0 32px",
    caretColor: "var(--helixos-accent)",
  },
  ".cm-line": { padding: "0" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--helixos-accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--helixos-accent) 28%, transparent) !important",
  },
  ".cm-placeholder": { color: "var(--helixos-color-fg-tertiary)" },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--helixos-accent) 14%, transparent)",
  },
})

export interface EditorHandle {
  /** The selected text, or null when nothing is selected. */
  selection(): { from: number; to: number; text: string } | null
  /** Replace a range as one undoable step, and select the new text. */
  replace(from: number, to: number, text: string): void
  text(): string
  focus(): void
}

export interface EditorProps {
  /** Changing this key loads `value` as a new document (a different note). */
  docKey: string
  value: string
  onChange: (text: string) => void
  onReady?: (handle: EditorHandle) => void
}

export function Editor({ docKey, value, onChange, onReady }: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const change = useRef(onChange)
  change.current = onChange

  // A new editor state per note, so undo history never crosses notes.
  useEffect(() => {
    if (!host.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(highlight),
        highlightSelectionMatches(),
        checkboxes,
        EditorView.lineWrapping,
        placeholder("Start typing. The first line is the title."),
        theme,
        EditorView.contentAttributes.of({ "aria-label": "Note", spellcheck: "true" }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) change.current(u.state.doc.toString())
        }),
      ],
    })
    if (view.current) view.current.setState(state)
    else view.current = new EditorView({ state, parent: host.current })
    onReady?.({
      selection() {
        const v = view.current!
        const { from, to } = v.state.selection.main
        return from === to ? null : { from, to, text: v.state.sliceDoc(from, to) }
      },
      replace(from, to, text) {
        const v = view.current!
        v.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from, head: from + text.length },
        })
        v.focus()
      },
      text: () => view.current!.state.doc.toString(),
      focus: () => view.current!.focus(),
    })
    // Only a different note resets the editor; `value` changes are the editor's own edits.
  }, [docKey])

  useEffect(
    () => () => {
      view.current?.destroy()
      view.current = null
    },
    [],
  )

  return <div className="notes-editor" ref={host} />
}
