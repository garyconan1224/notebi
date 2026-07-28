// R7 向前修复验收脚本（feat/r7-fix-forward）。前置：npm i playwright-core，并安装系统 Chrome。
// 可用环境变量覆盖：CHROME_BIN、FRONTEND_URL、NODE_MODULE_DIR、ADDMATERIAL_REPORT、ADDMATERIAL_SCREENSHOT_DIR。
// R7 AddMaterial 实战演练：五种笔记类型 + 四种来源 + 高频设置同屏 + 无旧 action
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = process.env.NODE_MODULE_DIR
  ? createRequire(path.resolve(process.env.NODE_MODULE_DIR, 'package.json'))
  : createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const BASE = process.env.FRONTEND_URL || 'http://localhost:5181'
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOT_DIR = path.resolve(process.env.ADDMATERIAL_SCREENSHOT_DIR || './screenshots')
const REPORT_PATH = path.resolve(process.env.ADDMATERIAL_REPORT || './addmaterial-report.json')
fs.mkdirSync(SHOT_DIR, { recursive: true })

const results = []
function record(item, status, detail) {
  results.push({ item, status, detail })
  console.log(`${status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️'} ${item} :: ${detail}`)
}

async function visibleTexts(page) {
  return page.evaluate(() => document.body.innerText || '')
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(800)

  // 打开 AddMaterial 弹窗
  const addBtn = page.locator('[aria-label="新建内容"]').first()
  await addBtn.click()
  await page.waitForTimeout(1000)
  const bodyText = await visibleTexts(page)
  await page.screenshot({ path: path.join(SHOT_DIR, 'addmat-01-open.png') })

  // 1. 五种笔记类型
  const noteTypes = ['自动识别', '视频笔记', '图文笔记', '音频笔记', '混合笔记']
  const presentTypes = noteTypes.filter((t) => bodyText.includes(t))
  if (presentTypes.length === 5) record('五种笔记类型同屏', 'pass', `类型=${presentTypes.join('/')}`)
  else record('五种笔记类型同屏', 'fail', `缺失=${noteTypes.filter((t) => !presentTypes.includes(t)).join('/')}`)

  // 2. 四种来源流程：单条内容（链接）/ 本地上传 / 批量合集 / 选择合集（已有内容）
  const sources = {
    '单条内容(链接)': bodyText.includes('单条内容') || bodyText.includes('网络链接'),
    '本地上传': bodyText.includes('本地上传'),
    '批量合集': bodyText.includes('批量合集') || bodyText.includes('解析批量来源'),
    '选择合集(已有内容)': bodyText.includes('选择合集') || bodyText.includes('新建合集'),
  }
  const presentSources = Object.entries(sources).filter(([, v]) => v).map(([k]) => k)
  if (presentSources.length >= 4) record('四种来源流程入口', 'pass', `来源=${presentSources.join('/')}`)
  else record('四种来源流程入口', 'fail', `present=${presentSources.join('/')} detail=${JSON.stringify(sources)}`)

  // 3. 高频设置常驻同屏（auto 类型适用项；人数/画面参数按 R5-C “上下文不适用时隐藏”）
  const settings = ['笔记风格', '说话人', '补充说明', '视觉']
  const presentSettings = settings.filter((t) => bodyText.includes(t))
  if (presentSettings.length >= 4) record('高频设置常驻同屏', 'pass', `设置=${presentSettings.join('/')}（人数/画面参数随类型上下文显示）`)
  else record('高频设置常驻同屏', 'fail', `缺失=${settings.filter((t) => !presentSettings.includes(t)).join('/')}`)

  // 4. 无旧 action / 折叠器
  const leaked = ['学习笔记', '你要做什么', '高级设置', '逐帧复刻'].filter((t) => bodyText.includes(t))
  if (leaked.length === 0) record('无学习笔记/你要做什么/高级设置', 'pass', '旧 action 与折叠器均已移除')
  else record('无学习笔记/你要做什么/高级设置', 'fail', `泄漏=${leaked.join('/')}`)

  // 5. 五种类型可切换（点击类型卡标题，验证不报错）
  let switchOk = 0
  const switchFailures = []
  for (const t of noteTypes) {
    const card = page.locator('button.note-type-card').filter({ hasText: t }).first()
    try {
      await card.click({ timeout: 3000 })
      switchOk++
      await page.waitForTimeout(200)
    } catch (error) {
      switchFailures.push(`${t}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    }
  }
  await page.screenshot({ path: path.join(SHOT_DIR, 'addmat-02-types.png') })
  if (switchOk === 5) record('五种类型均可点击切换', 'pass', `成功切换=${switchOk}/5`)
  else record('五种类型均可点击切换', 'fail', `成功切换=${switchOk}/5；${switchFailures.join(' | ')}`)

  await browser.close()
  const report = {
    generated_at: new Date().toISOString(),
    checks: results,
    console_errors: consoleErrors,
    screenshots: {
      open: path.join(SHOT_DIR, 'addmat-01-open.png'),
      types: path.join(SHOT_DIR, 'addmat-02-types.png'),
    },
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log('\nSUMMARY', JSON.stringify({
    pass: results.filter(r => r.status === 'pass').length,
    fail: results.filter(r => r.status === 'fail').length,
    skip: results.filter(r => r.status === 'skip').length,
    consoleErrors: consoleErrors.length,
  }))
}

run().catch((e) => { console.error('FATAL', e); process.exit(1) })
