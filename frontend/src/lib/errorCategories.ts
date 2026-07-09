/** 错误分类——将后端原始错误文本映射为人类可读的类别与建议 */
export type ErrorCategory = 'network' | 'quota' | 'model_not_configured' | 'unsupported' | 'interrupted' | 'general'

export interface CategorizedError {
  category: ErrorCategory
  friendlyMessage: string
  suggestion: string
}

/** 关键词 → 分类映射，命中即停（按优先级从上到下） */
const CATEGORY_RULES: Array<{ pattern: RegExp; category: ErrorCategory }> = [
  { pattern: /后端重启|任务中断|server.*restart|interrupted|worker.*lost/i, category: 'interrupted' },
  { pattern: /429|限流|rate.?limit|quota.*exceed|配额/i, category: 'quota' },
  { pattern: /timeout|timed.?out|connect.*refus|ConnectionError|network|网络|ECONNREFUSED|ENOTFOUND/i, category: 'network' },
  { pattern: /no enabled provider|unsupported provider|需要.*api.?key|api.?key.*missing|api.?key.*required|未配置.*模型|模型.*未配置|model.*not.*(found|configured)|no.*provider/i, category: 'model_not_configured' },
  { pattern: /unsupported|not.?supported|不支持/i, category: 'unsupported' },
]

const SUGGESTIONS: Record<ErrorCategory, { friendly: string; suggestion: string }> = {
  network: {
    friendly: '网络连接失败',
    suggestion: '请检查网络连接，或稍后重试。如使用代理，确认代理配置正确。',
  },
  quota: {
    friendly: 'API 配额耗尽或请求限流',
    suggestion: '请稍后重试，或前往「设置 → 模型供应商」检查用量配额。降低并发数也能减少限流触发。',
  },
  model_not_configured: {
    friendly: '所需模型未配置或 API Key 缺失',
    suggestion: '请前往「设置 → 模型供应商」添加对应能力的供应商并填写 API Key。',
  },
  unsupported: {
    friendly: '不支持的内容或格式',
    suggestion: '当前平台或链接格式暂不支持，请尝试其他链接或本地文件。',
  },
  interrupted: {
    friendly: '任务被服务重启中断',
    suggestion: '服务重启会让正在下载或分析的任务失败。请点击重试，或进入批量处理页逐项重试。',
  },
  general: {
    friendly: '处理过程中发生错误',
    suggestion: '请查看下方原始错误日志，或稍后重试。',
  },
}

/** 根据原始错误文本返回分类结果 */
export function categorizeError(rawError: string | undefined | null): CategorizedError {
  const text = (rawError || '').trim()
  if (!text) {
    return { category: 'general', friendlyMessage: '处理过程中发生未知错误', suggestion: '请稍后重试。' }
  }

  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) {
      const s = SUGGESTIONS[rule.category]
      return { category: rule.category, friendlyMessage: s.friendly, suggestion: s.suggestion }
    }
  }

  const s = SUGGESTIONS.general
  return { category: 'general', friendlyMessage: s.friendly, suggestion: s.suggestion }
}
