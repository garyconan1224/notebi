/** 错误分类——将后端原始错误文本映射为人类可读的类别与建议 */
export type ErrorCategory =
  | 'network'
  | 'quota'
  | 'model_not_configured'
  | 'unsupported'
  | 'interrupted'
  | 'audio_source'
  | 'transcription'
  | 'speaker_identification'
  | 'summary'
  | 'general'

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
  { pattern: /音频下载|本地音频不存在|音频文件|audio.*(download|file|source)|invalid.*audio|无法读取音频/i, category: 'audio_source' },
  { pattern: /ASR|转写|语音转文字|whisper|transcrib/i, category: 'transcription' },
  { pattern: /说话人|diariz|pyannote|voiceprint|speaker/i, category: 'speaker_identification' },
  { pattern: /摘要生成|总结服务|summary.*(fail|error)|生成摘要/i, category: 'summary' },
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
  audio_source: {
    friendly: '音频文件无法读取',
    suggestion: '请确认文件仍存在、格式可播放且没有被其他程序占用；本地文件可尝试重新上传，链接音频可尝试直接下载后再导入。',
  },
  transcription: {
    friendly: '音频转写失败',
    suggestion: '请检查转写模型和 API Key 配置；音频过短、损坏、噪声过大或语言设置不匹配时也可能导致转写失败。',
  },
  speaker_identification: {
    friendly: '说话人识别不可用',
    suggestion: '请在添加音频时启用区分说话人，并在设置中配置声纹模型所需的环境和模型权限；未启用时仍可使用普通转写。',
  },
  summary: {
    friendly: '音频总结生成失败',
    suggestion: '请检查聊天模型供应商、模型名称和 API Key；也可以先保留转写结果，稍后单独新建总结。',
  },
  general: {
    friendly: '处理过程中发生错误',
    suggestion: '请查看下方原始错误日志，或稍后重试。',
  },
}

/** 设置页展示的音频错误原因说明，与结果页分类文案保持一致。 */
export const AUDIO_ERROR_GUIDANCE: Array<{
  title: string
  cause: string
  action: string
}> = [
  { title: '音频文件无法读取', cause: '文件不存在、链接失效、格式损坏或无权限读取。', action: '重新上传可播放的音频，或确认链接可直接访问。' },
  { title: '音频转写失败', cause: '转写模型/API Key 未配置、语言不匹配、音频太短或噪声过大。', action: '检查设置中的转写模型与语言；必要时更换音频或稍后重试。' },
  { title: '说话人识别不可用', cause: '未启用区分说话人，或声纹模型、模型权限、HF_TOKEN 等条件不满足。', action: '启用区分说话人并检查模型配置；普通转写不受影响。' },
  { title: '音频总结生成失败', cause: '聊天模型供应商、模型名称或 API Key 不可用，或请求超时/限流。', action: '检查模型供应商设置；可先查看转写，再重新新建总结。' },
  { title: '真实波形不可用', cause: '音频解码失败或任务运行环境没有可用的 ffmpeg。', action: '先确认音频能正常播放；如仍无波形，请检查服务端 ffmpeg 安装。' },
]

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
