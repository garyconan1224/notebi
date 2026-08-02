import { useRef } from 'react'
import { ImagePlus, RotateCcw } from 'lucide-react'

interface CoverControlsProps {
  manual: boolean
  onUpload: (file: File) => void
  onReset: () => void
}

/** 卡片封面上的轻量控制：更换图片或撤销手动覆盖，事件不应打开卡片。 */
export function CoverControls({ manual, onUpload, onReset }: CoverControlsProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="cover-controls" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        title="更换封面"
        aria-label="更换封面"
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus size={14} />
      </button>
      <input
        ref={inputRef}
        className="cover-controls-input"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        aria-label="选择封面图片"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onUpload(file)
          event.target.value = ''
        }}
      />
      {manual && (
        <button
          type="button"
          title="恢复自动封面"
          aria-label="恢复自动封面"
          onClick={onReset}
        >
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  )
}
