const CONTENT_TAG_RULES: Array<[string, RegExp]> = [
  ['AI', /\b(ai|llm|aigc|agent)\b|人工智能|大模型|智能体/i],
  ['大模型', /大模型|llm|language model|模型/i],
  ['知识库', /知识库|knowledge\s*base|rag|向量|检索增强/i],
  ['Codex', /codex/i],
  ['Claude', /claude/i],
  ['GPT', /\b(chatgpt|gpt[-\s]?\d*|openai)\b/i],
  ['DeepSeek', /deepseek|深度求索/i],
  ['Gemini', /gemini/i],
  ['Qwen', /qwen|通义|千问/i],
  ['Kimi', /\bkimi\b|月之暗面/i],
  ['Cursor', /\bcursor\b/i],
  ['Trae', /\btrae\b/i],
  ['Manus', /\bmanus\b/i],
  ['MCP', /\bmcp\b|model context protocol/i],
  ['B站', /bilibili|b站|哔哩|b23\.tv/i],
  ['YouTube', /youtube|youtu\.be/i],
  ['小红书', /xiaohongshu|xhslink|小红书/i],
  ['抖音', /douyin|iesdouyin|抖音/i],
  ['Obsidian', /obsidian/i],
  ['Notion', /notion/i],
  ['开源', /开源|open\s*source|github/i],
  ['编程', /编程|代码|开发|工程|程序|typescript|javascript|python|react|next\.?js|fastapi|api/i],
  ['自动化', /自动化|workflow|工作流|agent/i],
  ['提示词', /提示词|prompt|prompting|system prompt/i],
  ['工具评测', /评测|测评|对比|优缺点|推荐|benchmark/i],
  ['教程', /教程|how\s*to|指南|安装|配置|入门|学习/i],
  ['知识管理', /知识管理|笔记|双链|第二大脑|资料库|归档|检索/i],
  ['效率工具', /效率|生产力|workflow|工作流|自动化|工具链/i],
  ['产品设计', /产品|设计|ux|ui|交互|用户体验/i],
  ['商业', /商业|增长|运营|营销|销售|变现|创业/i],
  ['论文', /论文|paper|arxiv|research|研究/i],
  ['会议', /会议|纪要|meeting|待办|action item/i],
  ['播客', /播客|podcast|shownotes/i],
  ['复刻', /复刻|拆解|分镜|镜头|运镜|画面分析/i],
]

function flattenTagInput(parts: unknown[]): string {
  const text = parts
    .map((part) => {
      if (part == null) return ''
      if (typeof part === 'string') return part
      if (typeof part === 'number' || typeof part === 'boolean') return String(part)
      try {
        return JSON.stringify(part)
      } catch {
        return ''
      }
    })
    .filter(Boolean)
    .join('\n')
  return text.slice(0, 12_000)
}

export function inferContentTags(parts: unknown[], limit = 8): string[] {
  const text = flattenTagInput(parts)
  if (!text.trim()) return []
  const tags: string[] = []
  for (const [tag, pattern] of CONTENT_TAG_RULES) {
    if (pattern.test(text) && !tags.includes(tag)) tags.push(tag)
    if (tags.length >= limit) break
  }
  return tags
}
