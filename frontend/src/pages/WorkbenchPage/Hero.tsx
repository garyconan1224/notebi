import { productConfig } from '@/config/product'

export function Hero() {
  const copy = productConfig.mode === 'notebi'
    ? {
      title: '把内容变成清晰笔记',
      desc: '粘贴链接或拖入文件，NoteBi 自动识别内容类型，提取结构化笔记、字幕和重点摘要。',
    }
    : productConfig.mode === 'replicabi'
      ? {
        title: '把画面拆成复刻提示词',
        desc: '粘贴视频或图片素材，ReplicaBi 提取镜头结构、画面细节和可复用的创作提示词。',
      }
      : {
        title: '把内容变成清晰笔记',
        desc: '粘贴链接或拖入文件，NoteBi 自动识别内容类型，提取结构化笔记和重点摘要。',
      }

  return (
    <section className="hero">
      <div className="hero-pill">v0.3 BETA</div>
      <h1>
        {copy.title}
      </h1>
      <p>
        {copy.desc}
      </p>
    </section>
  )
}
