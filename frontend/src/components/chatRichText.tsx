import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'

const SOURCE_MARKER_RE = /【素材\s*(\d+)】/g

/** 把 【素材 N】 转成内部链接，再交给 react-markdown 渲染成可点击 chip。 */
function toMarkdownWithSourceLinks(content: string): string {
  return content.replace(
    SOURCE_MARKER_RE,
    (_match, index: string) => `[素材 ${index}](notebi-source://${index})`,
  )
}

/**
 * AI 回答富文本渲染：markdown 生效，【素材 N】渲染为可点击 chip。
 * 点击 chip 时回调素材索引（从 1 开始）。
 */
export function ChatRichText({
  content,
  onOpenSource,
}: {
  content: string
  onOpenSource?: (sourceIndex: number) => void
}) {
  return (
    <div className="note-chat-rich">
      <ReactMarkdown
        urlTransform={(url) =>
          url.startsWith('notebi-source://') ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children }) => {
            const prefix = 'notebi-source://'
            if (href?.startsWith(prefix)) {
              const index = Number(href.slice(prefix.length))
              return (
                <button
                  type="button"
                  className="note-chat-source-chip"
                  onClick={() => onOpenSource?.(index)}
                >
                  {children}
                </button>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {toMarkdownWithSourceLinks(content)}
      </ReactMarkdown>
    </div>
  )
}
