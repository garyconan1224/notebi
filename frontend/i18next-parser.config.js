/**
 * i18next-parser 配置
 *
 * 用途：扫描 src 下所有 .ts / .tsx 文件中的 t() 调用，自动合并/更新
 *       locales/<lang>/<ns>.json，保障 key 不丢失、未使用 key 可检测。
 *
 * 执行：
 *   npx i18next-parser --config i18next-parser.config.js
 *
 * CI 建议：
 *   npx i18next-parser --config i18next-parser.config.js --fail-on-update
 *   （若扫描结果导致 JSON 变更则 CI 失败，用于阻止遗漏的 i18n key）
 */
export default {
  // 扫描入口
  input: ['src/**/*.{ts,tsx}'],

  // 语言列表（与 src/locales/i18n.ts 的 SUPPORTED_LANGS 保持一致）
  locales: ['zh-CN', 'en-US'],

  // 输出路径：$LOCALE → 语言目录，$NAMESPACE → 命名空间文件名
  output: 'src/locales/$LOCALE/$NAMESPACE.json',

  // 命名空间
  defaultNamespace: 'common',
  namespaceSeparator: ':',
  keySeparator: '.',

  // 已存在的 value 不覆盖（避免翻译被清空）
  // - createOldCatalogs: false  不生成 *_old.json 备份文件
  // - keepRemoved: true         保留代码中不再使用的 key（人工审查后决策删除）
  createOldCatalogs: false,
  keepRemoved: true,

  // 输出格式
  sort: true,
  indentation: 2,

  // 默认值策略：
  //   - zh-CN：中文原文为源语言，value 留空由开发者手动填写
  //   - en-US：回退到 key 本身，提醒翻译人员补齐
  defaultValue: (locale, _namespace, key) => (locale === 'zh-CN' ? '' : key),

  // 词法选项
  lexers: {
    ts: ['JavascriptLexer'],
    tsx: ['JsxLexer'],
    default: ['JavascriptLexer'],
  },

  // 支持的上下文与复数形式（i18next 4+ 语法）
  contextSeparator: '_',
  pluralSeparator: '_',

  // 显式排除伪 key（parser 误识别而未在代码中真实使用的 key）
  // form.title 在 NoteForm.tsx 中使用时已明确指定 useTranslation('home')，
  // 无需在 common namespace 中重复
  ignoredKeys: ['form'],

  verbose: false,
  failOnWarnings: false,
}

