import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownText } from './markdown'

function render(text: string): string {
  return renderToStaticMarkup(<MarkdownText text={text} />)
}

describe('markdown rendering', () => {
  it('turns an inline sequence of steps into a readable ordered list', () => {
    const html = render(
      'Before the steps.\n\nSteps: 1. open the wizard. 2. pay on Stripe. 3. check the webhook.\n\nAfter the steps.',
    )

    expect(html).toMatch(/<p>Steps:<\/p>\s*<ol>/)
    expect(html).toContain('<li>open the wizard.</li>')
    expect(html).toContain('<li>pay on Stripe.</li>')
    expect(html).toContain('<li>check the webhook.</li>')
    expect(html).toContain('<p>After the steps.</p>')
  })

  it('leaves prose, inline code, and fenced code alone', () => {
    const html = render(
      'Version 1. worked and version 2. failed.\n\n`Steps: 1. first 2. second`\n\n```text\nSteps: 1. first 2. second\n```',
    )

    expect(html).not.toContain('<ol>')
    expect(html).toContain('<code>Steps: 1. first 2. second</code>')
  })

  it('preserves links and emphasis inside repaired steps', () => {
    const html = render('Steps: 1. open [the site](https://example.com). 2. click **buy**.')

    expect(html).toContain('<a href="https://example.com"')
    expect(html).toContain('<strong>buy</strong>')
    expect(html.match(/<li>/g)).toHaveLength(2)
  })

  it('leaves nonsequential numbers and existing lists alone', () => {
    expect(render('Steps: 1. first 3. third')).not.toContain('<ol>')
    expect(render('Steps:\n\n1. first\n2. second').match(/<ol>/g)).toHaveLength(1)
  })
})
