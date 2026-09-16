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
}

/** turns raw html nodes into literal text, so `<script>` reads as typed and never runs */
function remarkHtmlAsText() {
  const walk = (node: MdNode) => {
    if (node.type === 'html') node.type = 'text'
    node.children?.forEach(walk)
  }
  return (tree: MdNode) => walk(tree)
}

const plugins = [remarkGfm, remarkBreaks, remarkHtmlAsText]

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
