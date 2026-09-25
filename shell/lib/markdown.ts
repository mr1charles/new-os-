/**
 * Minimal Markdown to Pango markup for assistant replies in GTK labels.
 * Supports headings, bold, italic, strikethrough, inline code, fenced code blocks, links,
 * bullet and numbered lists, and block quotes. Everything else is escaped text.
 */

export function escapeMarkup(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatEmphasis(escaped: string): string {
  return escaped
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<b>$1</b>")
    .replace(/__(?=\S)(.+?)(?<=\S)__/g, "<b>$1</b>")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "<s>$1</s>")
    .replace(/(^|[^*\w])\*(?=\S)(.+?)(?<=\S)\*(?!\*)/g, "$1<i>$2</i>")
    .replace(/(^|[^_\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1<i>$2</i>")
}

function formatLinks(text: string): string {
  // Operates on raw text segments; escapes pieces as it goes.
  const out: string[] = []
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let last = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    out.push(formatEmphasis(escapeMarkup(text.slice(last, match.index))))
    out.push(`<a href="${escapeMarkup(match[2]!)}">${formatEmphasis(escapeMarkup(match[1]!))}</a>`)
    last = match.index + match[0].length
  }
  out.push(formatEmphasis(escapeMarkup(text.slice(last))))
  return out.join("")
}

/** Inline formatting. Code spans are protected from every other rule. */
export function inlineToPango(text: string): string {
  const parts = text.split(/(`[^`]+`)/g)
  return parts
    .map((part) =>
      part.startsWith("`") && part.endsWith("`") && part.length > 2
        ? `<tt>${escapeMarkup(part.slice(1, -1))}</tt>`
        : formatLinks(part),
    )
    .join("")
}

export function markdownToPango(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const out: string[] = []
  let inCode = false
  const code: string[] = []

  for (const line of lines) {
    const fence = /^\s*```/.test(line)
    if (fence) {
      if (inCode) {
        out.push(`<tt>${escapeMarkup(code.join("\n"))}</tt>`)
        code.length = 0
      }
      inCode = !inCode
      continue
    }
    if (inCode) {
      code.push(line)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      const content = inlineToPango(heading[2]!)
      out.push(level <= 2 ? `<span size="large"><b>${content}</b></span>` : `<b>${content}</b>`)
      continue
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      const indent = "  ".repeat(Math.min(3, Math.floor(bullet[1]!.length / 2)))
      out.push(`${indent}• ${inlineToPango(bullet[2]!)}`)
      continue
    }

    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      const indent = "  ".repeat(Math.min(3, Math.floor(numbered[1]!.length / 2)))
      out.push(`${indent}${numbered[2]}. ${inlineToPango(numbered[3]!)}`)
      continue
    }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      out.push(`<i>${inlineToPango(quote[1]!)}</i>`)
      continue
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      out.push("──────────")
      continue
    }

    out.push(inlineToPango(line))
  }

  // An unterminated fence during streaming still renders as code.
  if (inCode && code.length > 0) out.push(`<tt>${escapeMarkup(code.join("\n"))}</tt>`)
  return out.join("\n")
}
