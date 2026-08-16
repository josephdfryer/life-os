// Minimal, dependency-free markdown renderer for the controlled subset used in
// theory bodies (h1/h2, paragraphs, bullet lists, blockquotes, bold, italic).
// Input is HTML-escaped first, so even though theory content is system-generated,
// nothing in it can inject markup.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
}

export function renderTheoryMarkdown(markdown: string): string {
  const lines = markdown.split("\n")
  const out: string[] = []
  let inList = false
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(" "))}</p>`)
      paragraph = []
    }
  }
  const closeList = () => {
    if (inList) {
      out.push("</ul>")
      inList = false
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.trim() === "") {
      flushParagraph()
      closeList()
      continue
    }
    if (line.startsWith("## ")) {
      flushParagraph(); closeList()
      out.push(`<h2>${inline(line.slice(3))}</h2>`)
    } else if (line.startsWith("# ")) {
      flushParagraph(); closeList()
      out.push(`<h1>${inline(line.slice(2))}</h1>`)
    } else if (line.startsWith("> ")) {
      flushParagraph(); closeList()
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`)
    } else if (line.startsWith("- ")) {
      flushParagraph()
      if (!inList) { out.push("<ul>"); inList = true }
      out.push(`<li>${inline(line.slice(2))}</li>`)
    } else {
      closeList()
      paragraph.push(line.trim())
    }
  }
  flushParagraph()
  closeList()
  return out.join("\n")
}

export function extractSectionItems(markdown: string, section: string): string[] {
  const lines = markdown.split("\n")
  const items: string[] = []
  let inSection = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith("## ")) {
      inSection = line.slice(3).trim().toLowerCase() === section.toLowerCase()
      continue
    }
    if (inSection && line.startsWith("- ")) items.push(line.slice(2).trim())
  }
  return items
}
