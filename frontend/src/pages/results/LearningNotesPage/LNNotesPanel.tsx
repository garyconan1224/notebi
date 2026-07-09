import HtmlView from './HtmlView'
import MdView from './MdView'

interface LNNotesPanelProps {
  markdown: string
  onMarkdownChange: (md: string) => void
  view: 'html' | 'md'
  onSwitchView: (v: 'html' | 'md') => void
  onSeek?: (sec: number) => void
}

export default function LNNotesPanel({ markdown, onMarkdownChange, view, onSwitchView, onSeek }: LNNotesPanelProps) {
  return (
    <div className="ln-notes-panel">
      <div className="ln-toolbar">
        <button
          data-active={view === 'html'}
          onClick={() => onSwitchView('html')}
        >阅读<span className="ln-tab-sub">看效果</span></button>
        <button
          data-active={view === 'md'}
          onClick={() => onSwitchView('md')}
        >Markdown<span className="ln-tab-sub">可编辑</span></button>
      </div>
      {view === 'html'
        ? <HtmlView markdown={markdown} onSeek={onSeek} />
        : <MdView markdown={markdown} onMarkdownChange={onMarkdownChange} />}
    </div>
  )
}
