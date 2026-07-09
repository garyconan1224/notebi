import OpenAIMono from '@lobehub/icons/es/OpenAI/components/Mono'
import AnthropicMono from '@lobehub/icons/es/Anthropic/components/Mono'
import { Bot } from 'lucide-react'

/**
 * 按 provider.kind 渲染单色品牌 logo（DESIGN_NOTES_SETTINGS.md §4.2 / R3）。
 *
 * - 必须使用 `@lobehub/icons/es/<Brand>/components/Mono` 最深子路径 import；
 *   禁止走 barrel 以规避 antd-style 间接拉入（见 R3）。
 * - 未命中的 kind（google / ollama / openai 占位）统一回退到 lucide Bot 图标，
 *   保留尺寸/色彩一致性，避免列表中图标大小错落。
 */
export interface ProviderIconProps {
  kind: string
  size?: number
  className?: string
}

export function ProviderIcon({ kind, size = 18, className }: ProviderIconProps) {
  if (kind === 'openai' || kind === 'openai_compatible') {
    return <OpenAIMono size={size} className={className} />
  }
  if (kind === 'anthropic') {
    return <AnthropicMono size={size} className={className} />
  }
  // M1.6 占位：后续补 Google / Ollama / SiliconFlow 单色图标
  return <Bot size={size} className={className} />
}

export default ProviderIcon

