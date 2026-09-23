// one markdown renderer for descriptions, notes and comments: gfm tables and task lists,
// single newlines kept as breaks, raw html shown as text, unsafe urls dropped

import { memo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  ordered?: boolean
  start?: number
  spread?: boolean
}

/** repairs paragraphs such as `Steps: 1. first 2. second` without changing stored text */
function remarkInlineSteps() {
  const expand = (paragraph: MdNode): MdNode[] => {
    const children = paragraph.children
    const first = children?.[0]
    if (!children || first?.type !== 'text' || !first.value) return [paragraph]

    const opening = /^(?:([a-z][a-z -]{0,30}:)\s*)?1\.\s+/i.exec(first.value)
    if (!opening) return [paragraph]

    const items: MdNode[][] = [[]]
    const append = (node: MdNode) => items.at(-1)?.push(node)
    const splitText = (value: string) => {
      const marker = /(\s+)(\d+)\.\s+/g
      let from = 0
      for (const match of value.matchAll(marker)) {
        if (Number(match[2]) !== items.length + 1 || match.index === undefined) continue
        if (match.index > from) append({ type: 'text', value: value.slice(from, match.index) })
        items.push([])
        from = match.index + match[0].length
      }
      if (from < value.length) append({ type: 'text', value: value.slice(from) })
    }

    splitText(first.value.slice(opening[0].length))
    for (const child of children.slice(1)) {
      if (child.type === 'text') splitText(child.value ?? '')
      else append(child)
    }
    if (items.length < 2) return [paragraph]

    for (const item of items) {
      if (item[0]?.type === 'text') item[0].value = item[0].value?.trimStart() ?? ''
      const last = item.at(-1)
      if (last?.type === 'text') last.value = last.value?.trimEnd() ?? ''
      if (!item.some((node) => node.type !== 'text' || node.value)) return [paragraph]
    }

    const list: MdNode = {
      type: 'list',
      ordered: true,
      start: 1,
      spread: false,
      children: items.map((item) => ({
        type: 'listItem',
        spread: false,
        children: [{ type: 'paragraph', children: item }],
      })),
    }
    return opening[1]
      ? [{ type: 'paragraph', children: [{ type: 'text', value: opening[1] }] }, list]
      : [list]
  }

  const walk = (node: MdNode) => {
    if (!node.children) return
    node.children = node.children.flatMap((child) =>
      child.type === 'paragraph' ? expand(child) : [child],
    )
    node.children.forEach(walk)
  }
  return (tree: MdNode) => walk(tree)
}

/** turns raw html nodes into literal text, so `<script>` reads as typed and never runs */
function remarkHtmlAsText() {
  const walk = (node: MdNode) => {
    if (node.type === 'html') node.type = 'text'
    node.children?.forEach(walk)
  }
  return (tree: MdNode) => walk(tree)
}

const plugins = [remarkGfm, remarkInlineSteps, remarkBreaks, remarkHtmlAsText]

const components: Components = {
  a: ({ node: _node, href, children, ...rest }) =>
    href ? (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // a wide table scrolls inside its own box instead of stretching the pane
  table: ({ node: _node, ...rest }) => (
    <div className="mdtable">
      <table {...rest} />
    </div>
  ),
}

/** renders stored markdown read-only; `className` picks the surface's type scale */
export const MarkdownText = memo(function MarkdownText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  return (
    <div className={className ? `md ${className}` : 'md'}>
      <Markdown remarkPlugins={plugins} components={components}>
        {text}
      </Markdown>
    </div>
  )
})
