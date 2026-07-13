import { type ReactNode } from 'react'

// Rendu markdown minimal et SÛR pour les réponses de l'assistant : on construit
// des nœuds React (pas de dangerouslySetInnerHTML → pas d'injection HTML). Sous-
// ensemble couvert : titres (#/##/###), gras, italique, code inline, blocs de
// code ```, listes (- / 1.), citations >, liens [txt](url), sauts de ligne.

const INLINE_RE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[2] != null || m[3] != null) nodes.push(<strong key={key++}>{m[2] ?? m[3]}</strong>)
    else if (m[4] != null || m[5] != null) nodes.push(<em key={key++}>{m[4] ?? m[5]}</em>)
    else if (m[6] != null) nodes.push(<code key={key++} className="assistant-md-code">{m[6]}</code>)
    else if (m[7] != null) nodes.push(
      <a key={key++} href={m[8]} target="_blank" rel="noreferrer">{m[7]}</a>,
    )
    last = INLINE_RE.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Bloc de code ``` ... ```
    if (line.trim().startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++ }
      i++ // saute la clôture
      blocks.push(<pre key={key++} className="assistant-md-pre"><code>{buf.join('\n')}</code></pre>)
      continue
    }

    // Titres # ## ###
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      const Tag = (`h${Math.min(h[1].length + 2, 6)}`) as 'h3' | 'h4' | 'h5'
      blocks.push(<Tag key={key++} className="assistant-md-h">{renderInline(h[2])}</Tag>)
      i++
      continue
    }

    // Citation >
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++ }
      blocks.push(<blockquote key={key++} className="assistant-md-quote">{renderInline(buf.join(' '))}</blockquote>)
      continue
    }

    // Liste à puces - ou *
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++ }
      blocks.push(<ul key={key++} className="assistant-md-ul">{items.map((it, idx) => <li key={idx}>{renderInline(it)}</li>)}</ul>)
      continue
    }

    // Liste numérotée 1.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++ }
      blocks.push(<ol key={key++} className="assistant-md-ol">{items.map((it, idx) => <li key={idx}>{renderInline(it)}</li>)}</ol>)
      continue
    }

    // Ligne vide → séparateur de paragraphe
    if (line.trim() === '') { i++; continue }

    // Paragraphe : lignes consécutives non spéciales, séparées par <br>
    const para: string[] = []
    while (
      i < lines.length
      && lines[i].trim() !== ''
      && !/^\s*[-*]\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && !/^#{1,3}\s+/.test(lines[i])
      && !lines[i].trim().startsWith('```')
    ) { para.push(lines[i]); i++ }
    blocks.push(
      <p key={key++} className="assistant-md-p">
        {para.flatMap((l, idx) => (idx === 0 ? renderInline(l) : [<br key={`br${idx}`} />, ...renderInline(l)]))}
      </p>,
    )
  }

  return <>{blocks}</>
}
