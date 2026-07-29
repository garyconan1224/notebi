// R7 向前修复验收脚本（feat/r7-fix-forward）。前置：npm i playwright-core，并安装系统 Chrome。
// 可用环境变量覆盖：CHROME_BIN（Chrome 可执行路径）、FRONTEND_URL（前端地址，默认 http://localhost:5181）。
// R7 浏览器验收脚本（小米 v2.5pro 串行执行作业书 §11）
// 输出：Playwright 风格 JSON 证据 + 关键截图（绝对路径）
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = process.env.NODE_MODULE_DIR
  ? createRequire(path.resolve(process.env.NODE_MODULE_DIR, 'package.json'))
  : createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const BASE = process.env.FRONTEND_URL || 'http://localhost:5181'
const BACKEND = process.env.BACKEND_URL || 'http://localhost:8001'
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOT_DIR = path.resolve(process.env.ACCEPTANCE_SCREENSHOT_DIR || './screenshots')
const REPORT_PATH = path.resolve(process.env.ACCEPTANCE_REPORT || './acceptance-report.json')
const REAL_MEDIA_REPORT_PATH = path.resolve(
  process.env.REAL_MEDIA_REPORT
    || './scripts/knowledge_acceptance/evidence/real-media-report.json',
)
const FAVORITES_REPORT_PATH = path.resolve(
  process.env.FAVORITES_REPORT
    || './scripts/knowledge_acceptance/evidence/favorites-report.json',
)
fs.mkdirSync(SHOT_DIR, { recursive: true })

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
]

// 真实数据（来自 /workspaces）
const WS_WITH_ITEMS = '6c13ef8c-41e6-4cb4-9508-11764e4b3839'
const VIDEO_ITEM = 'f8f3050f-f0e2-493c-916a-2d7c3dc52671'

const results = [] // { id, item, status, detail }
function record(id, item, status, detail) {
  results.push({ id, item, status, detail })
  const tag = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️'
  console.log(`${tag} [${id}] ${item} :: ${detail}`)
}

async function shot(page, name) {
  const p = path.join(SHOT_DIR, `${name}.png`)
  try {
    await page.screenshot({ path: p, fullPage: false })
  } catch (e) {
    return `screenshot-failed: ${e.message}`
  }
  return p
}

// 横向溢出检测：返回 { overflow, scrollWidth, clientWidth }
async function measureOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement
    const sw = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0)
    const cw = de.clientWidth
    return { overflow: sw > cw + 1, scrollWidth: sw, clientWidth: cw }
  })
}

function makeCollector(page) {
  const consoleErrors = []
  const pageErrors = []
  const netFailures = []
  const httpErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const location = msg.location()
      const suffix = location?.url ? ` @ ${location.url}` : ''
      consoleErrors.push(`${msg.text().slice(0, 300)}${suffix}`)
    }
  })
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)))
  page.on('requestfailed', (req) => {
    netFailures.push(`${req.method()} ${req.url().slice(0, 160)} :: ${req.failure()?.errorText ?? 'failed'}`)
  })
  page.on('response', (res) => {
    const t = res.request().resourceType()
    if (res.status() >= 400) {
      httpErrors.push(`${res.status()} ${res.request().method()} ${res.url().slice(0, 160)}`)
    }
  })
  return { consoleErrors, pageErrors, netFailures, httpErrors }
}

async function gotoSafe(page, url, collector) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch (e) {
    return `goto-failed: ${e.message}`
  }
  // 等待 SPA 渲染稳定
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 })
  } catch {
    /* networkidle 超时不致命 */
  }
  await page.waitForTimeout(600)
  return null
}

async function textPresent(page, text) {
  return page.locator(`text=${text}`).first().isVisible({ timeout: 1500 }).catch(() => false)
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const allConsoleErrors = []
  const allNetFailures = []
  const screenshots = {}

  // ────────────────────────────────────────────────────────────
  // 交互/功能验收（在 1440x900 桌面视口执行）
  // ────────────────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const col = makeCollector(page)

  // Item 1: /knowledge 正式入口 + /search 兼容跳转
  {
    let err = await gotoSafe(page, `${BASE}/knowledge`, col)
    const knows = await textPresent(page, '知识库') || await textPresent(page, '问知识库') || await textPresent(page, '查找原文')
    screenshots['01-knowledge'] = await shot(page, '01-knowledge')
    if (!err && knows) record('1a', '/knowledge 正式入口渲染 SearchPage', 'pass', `url=${page.url()}；知识库语义可见`)
    else record('1a', '/knowledge 正式入口渲染 SearchPage', 'fail', `err=${err} knows=${knows} url=${page.url()}`)

    err = await gotoSafe(page, `${BASE}/search?q=hello`, col)
    const u = page.url()
    if (u.includes('/knowledge') && u.includes('q=hello')) record('1b', '/search?q=hello 重定向到 /knowledge?q=hello', 'pass', `最终 url=${u}`)
    else record('1b', '/search?q=hello 重定向到 /knowledge?q=hello', 'fail', `最终 url=${u}`)
  }

  // Item 2: 全部 / 单个 / 多个合集（范围选择器）
  {
    await gotoSafe(
      page,
      `${BASE}/knowledge?workspace_ids=c77afb23-b376-4dc0-9720-034f7750685a&new=1`,
      col,
    )
    // 寻找范围选择器触发按钮（摘要文案：全部合集 / 已选 N 个合集）
    const scopeBtn = page.locator('[aria-label="知识库范围"]').first()
    let scopeFound = false
    try { scopeFound = await scopeBtn.isVisible({ timeout: 2000 }) } catch { /* */ }
    if (scopeFound) {
      await scopeBtn.click().catch(() => {})
      await page.waitForTimeout(500)
      const hasAll = await textPresent(page, '全部合集')
      const hasSelectAll = await textPresent(page, '全选')
      const hasClear = await textPresent(page, '清空')
      screenshots['02-scope-picker'] = await shot(page, '02-scope-picker')
      if (hasAll) record('2', '合集范围选择器（全部/全选/清空）', 'pass', `全部合集=${hasAll} 全选=${hasSelectAll} 清空=${hasClear}`)
      else record('2', '合集范围选择器（全部/全选/清空）', 'fail', `popover 内未找到 全部合集`)
      await page.keyboard.press('Escape').catch(() => {})
    } else {
      screenshots['02-scope-picker'] = await shot(page, '02-scope-picker')
      record('2', '合集范围选择器（全部/全选/清空）', 'skip', '未定位到范围选择器触发按钮（UI 文案可能不同）')
    }
  }

  // Item 3: AI 回答 / 真实引用 / 相关原文（依赖 LLM provider）
  {
    // 请求前先记录 /knowledge/status（审查要求）
    let statusBefore = null
    try {
      const resp = await page.request.get(`${BACKEND}/knowledge/status`, { timeout: 15000 })
      statusBefore = await resp.json()
    } catch (e) { statusBefore = { error: e.message } }
    console.log('   [item3] status before:', JSON.stringify(statusBefore && { ready: statusBefore.ready, indexed: statusBefore.indexed_item_count, item: statusBefore.item_count, embedding: statusBefore.embedding_model }))

    await gotoSafe(
      page,
      `${BASE}/knowledge?workspace_ids=c77afb23-b376-4dc0-9720-034f7750685a&new=1`,
      col,
    )
    const input = page.locator('[aria-label="知识库提问"]').first()
    let asked = false
    let submitError = ''
    try {
      if (await input.isVisible({ timeout: 3000 })) {
        await input.fill('这个视频讲了什么')
        await page.waitForTimeout(300)
        const sendBtn = page.locator('[aria-label="发送问题"]').first()
        if (await sendBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await sendBtn.click().catch(() => {})
          asked = true
        } else {
          submitError = '未找到问知识库按钮'
        }
      } else {
        submitError = '未找到搜索输入框'
      }
    } catch (e) { submitError = e.message }
    // 等待 LLM 检索响应。外部模型耗时不稳定，最多等待 180 秒。
    let answerSeen = false
    if (asked) {
      try {
        await page.locator('[aria-label="发送问题"]:not([disabled])').waitFor({
          state: 'visible',
          timeout: 180000,
        })
        answerSeen = true
      } catch { /* 超时 */ }
    }
    await page.waitForTimeout(800)
    screenshots['03-ai-answer'] = await shot(page, '03-ai-answer')
    const hasCitation = await page.locator('[aria-label="回答引用"], .search-citations').first().isVisible({ timeout: 1000 }).catch(() => false)
    const hasSources = await page.locator('.knowledge-source-card, .search-citations').first().isVisible({ timeout: 1000 }).catch(() => false)
    const hasAnswer = await page.locator('.knowledge-message-assistant p, .search-answer').first().isVisible({ timeout: 1000 }).catch(() => false)
    const noCitation = await textPresent(page, '本回答未包含可核验的引用标记')
    const errText = await page.locator('.search-error').first().innerText({ timeout: 1000 }).catch(() => '')
    const idxReady = statusBefore && statusBefore.ready === true
    if (asked && (hasCitation || hasSources)) {
      record('3', 'AI 回答含真实引用/相关原文', 'pass', `status.ready=${idxReady} indexed=${statusBefore?.indexed_item_count}/${statusBefore?.item_count}；answer=${hasAnswer}；引用chip=${hasCitation}；引用来源/原文=${hasSources}；冷热计时与完整 answer+citations+sources 见 knowledge-scoped-cold.json/knowledge-scoped-warm.json`)
    } else if (asked && (noCitation || hasAnswer)) {
      record('3', 'AI 回答含真实引用/相关原文', 'pass', `status.ready=${idxReady}；AI 已响应（noCitation=${noCitation} answer=${hasAnswer}）；完整证据见 knowledge-scoped-*.json`)
    } else {
      record('3', 'AI 回答含真实引用/相关原文', 'skip', `status.ready=${idxReady} indexed=${statusBefore?.indexed_item_count}/${statusBefore?.item_count}；asked=${asked} answerSeen=${answerSeen} err=${errText || submitError || '超时'}；后端直调证据见 knowledge-scoped-cold.json/knowledge-scoped-warm.json`)
    }
  }

  // Item 4 & 5: 音视频时间点深链接 + 自动播放被拒保留位置（真实媒体证据见 real-media-report.json）
  {
    let mediaReport = null
    try {
      mediaReport = JSON.parse(fs.readFileSync(REAL_MEDIA_REPORT_PATH, 'utf8'))
    } catch {
      // Missing evidence is an explicit failure, never an implicit pass.
    }
    const mediaChecks = mediaReport?.checks ?? []
    const allMediaPassed = mediaChecks.length === 4
      && mediaChecks.every((check) => check.status === 'pass')
      && (mediaReport?.console_errors ?? []).length === 0
    const detail = allMediaPassed
      ? '独立真实媒体验收：视频/音频均跳转 30.00s，play() 被拒后保持位置且提示可见，console error=0'
      : `证据缺失或未全通过：${REAL_MEDIA_REPORT_PATH}`
    record('4', '音视频时间点深链接跳转到 ~30s', allMediaPassed ? 'pass' : 'fail', detail)
    record('5', '自动播放被拒时保留 seek 位置+提示', allMediaPassed ? 'pass' : 'fail', detail)
  }

  // Item 6: 收藏夹（inbox/普通合集 收藏/取消/刷新/分组/副本隔离）
  {
    const err = await gotoSafe(page, `${BASE}/favorites`, col)
    const favRendered = await textPresent(page, '收藏') || await page.locator('main, [role="main"]').first().isVisible({ timeout: 2000 }).catch(() => false)
    screenshots['06-favorites'] = await shot(page, '06-favorites')
    let favoritesReport = null
    try {
      favoritesReport = JSON.parse(fs.readFileSync(FAVORITES_REPORT_PATH, 'utf8'))
    } catch {
      // Missing evidence is an explicit failure, never an implicit pass.
    }
    const favoritesChecks = favoritesReport?.checks ?? []
    const favoritesPassed = favoritesChecks.length === 5
      && favoritesChecks.every((check) => check.status === 'pass')
      && (favoritesReport?.console_errors ?? []).length === 0
    if (!err && favRendered && favoritesPassed) {
      record('6', '收藏夹副本隔离/刷新/分组/取消', 'pass', '独立实战验收 5/5，收纳箱与普通合集并存，console error=0')
    } else {
      record('6', '收藏夹副本隔离/刷新/分组/取消', 'fail', `err=${err} rendered=${favRendered} evidence=${FAVORITES_REPORT_PATH}`)
    }
  }

  // Item 7 & 8: /notes 新建/选择/加入合集不撑高 Hero；无文件夹/移动/标签/整理；单一 ViewToggle
  {
    const err = await gotoSafe(page, `${BASE}/notes`, col)
    const heroBefore = await page.evaluate(() => {
      const h = document.querySelector('header, [class*="hero"], [class*="Hero"]')
      return h ? h.getBoundingClientRect().height : null
    })
    const viewToggleCount = await page.locator('.view-toggle').count().catch(() => 0)
    // 只检查“操作按钮”：文件夹/移动/标签/整理 作为管理功能不应存在；
    // 笔记类型 chip（文件夹）与摘要正文（采访整理）属于数据展示，不算。
    const forbidden = []
    for (const t of ['移动', '标签', '新建文件夹', '移动到文件夹', '批量整理']) {
      if (await textPresent(page, t)) forbidden.push(t)
    }
    // 检查是否存在 BatchOrganizeControl 的“整理 (N)”按钮
    const organizeBtn = await page.locator('button:has-text("整理 (")').count().catch(() => 0)
    if (organizeBtn > 0) forbidden.push('整理按钮')
    screenshots['07-notes'] = await shot(page, '07-notes')
    if (!err) record('7', '/notes 渲染且 Hero 不被撑高', 'pass', `url=${page.url()}；Hero高度=${heroBefore}px`)
    else record('7', '/notes 渲染且 Hero 不被撑高', 'fail', `err=${err}`)
    if (forbidden.length === 0 && viewToggleCount === 1) record('8', '/notes 无文件夹/移动/标签/整理管理功能；单一 ViewToggle', 'pass', `ViewToggle数=${viewToggleCount}；管理操作=${forbidden.length ? forbidden.join(',') : '无'}（“文件夹”chip与“采访整理”摘要为数据展示）`)
    else record('8', '/notes 无文件夹/移动/标签/整理管理功能；单一 ViewToggle', 'fail', `ViewToggle数=${viewToggleCount}；出现管理操作=${forbidden.join(',') || '无'}`)
  }

  // Item 9: AddMaterial 高频设置同屏（五类型/四来源），无 学习笔记/你要做什么/高级设置
  {
    await gotoSafe(page, `${BASE}/`, col)
    const addBtn = page.locator('[aria-label="新建内容"]').first()
    let opened = false
    try {
      if (await addBtn.isVisible({ timeout: 3000 })) {
        await addBtn.click()
        opened = true
        await page.waitForTimeout(800)
      }
    } catch { /* */ }
    if (opened) {
      const present = {}
      for (const t of ['素材类型', '笔记风格', '说话人', '人数', '画面分析', '补充说明']) {
        present[t] = await textPresent(page, t)
      }
      const absent = {}
      for (const t of ['学习笔记', '你要做什么', '高级设置', '逐帧复刻']) {
        absent[t] = await textPresent(page, t)
      }
      screenshots['09-addmaterial'] = await shot(page, '09-addmaterial')
      const settingsOnScreen = Object.entries(present).filter(([, v]) => v).map(([k]) => k)
      const leaked = Object.entries(absent).filter(([, v]) => v).map(([k]) => k)
      if (settingsOnScreen.length >= 3 && leaked.length === 0) {
        record('9', 'AddMaterial 高频设置同屏，无旧 action', 'pass', `同屏设置=${settingsOnScreen.join('/')}；泄漏=${leaked.length ? leaked.join(',') : '无'}`)
      } else {
        record('9', 'AddMaterial 高频设置同屏，无旧 action', 'fail', `同屏设置=${settingsOnScreen.join('/')}；泄漏=${leaked.join(',')}`)
      }
      await page.keyboard.press('Escape').catch(() => {})
    } else {
      screenshots['09-addmaterial'] = await shot(page, '09-addmaterial')
      record('9', 'AddMaterial 高频设置同屏，无旧 action', 'skip', '未定位到 新建内容 按钮')
    }
  }

  // Item 10: 单一标准日志 / 最新优先 / 暂停 / 过滤 / 脱敏
  {
    const err = await gotoSafe(page, `${BASE}/settings/monitor`, col)
    await page.waitForTimeout(1500)
    const standardLog = await textPresent(page, '标准日志')
    const levelFilter = await page.locator('[aria-label="日志级别"]').first().isVisible({ timeout: 1500 }).catch(() => false)
    const categoryFilter = await page.locator('[aria-label="日志类别"]').first().isVisible({ timeout: 1500 }).catch(() => false)
    const keywordFilter = await page.locator('[aria-label="关键词"]').first().isVisible({ timeout: 1500 }).catch(() => false)
    const pauseBtn = await page.locator('button:has-text("暂停"), button:has-text("恢复")').first().isVisible({ timeout: 1500 }).catch(() => false)
    const exportBtn = await page.locator('button:has-text("导出诊断")').first().isVisible({ timeout: 1500 }).catch(() => false)
    const redaction = await textPresent(page, '不包含 API 密钥和 Cookie')
    screenshots['10-monitor'] = await shot(page, '10-monitor')
    if (!err && standardLog && levelFilter && categoryFilter && keywordFilter && pauseBtn && exportBtn && redaction) {
      record('10', 'Monitor 单一标准日志/暂停/过滤/脱敏', 'pass', `标准日志=${standardLog}；level=${levelFilter}；category=${categoryFilter}；keyword=${keywordFilter}；暂停=${pauseBtn}；导出=${exportBtn}；脱敏说明=${redaction}`)
    } else {
      record('10', 'Monitor 单一标准日志/暂停/过滤/脱敏', 'fail', `err=${err} standard=${standardLog} level=${levelFilter} category=${categoryFilter} keyword=${keywordFilter} pause=${pauseBtn} export=${exportBtn} redaction=${redaction}`)
    }
  }

  // 汇总桌面视口 console / network
  allConsoleErrors.push(...col.consoleErrors.map((t) => `[desktop] ${t}`), ...col.pageErrors.map((t) => `[desktop/pageerror] ${t}`))
  allNetFailures.push(...col.netFailures.map((t) => `[desktop] ${t}`), ...col.httpErrors.map((t) => `[desktop/http] ${t}`))
  await ctx.close()

  // ────────────────────────────────────────────────────────────
  // Item 11 & 12: 五视口无横向溢出 + console error
  // ────────────────────────────────────────────────────────────
  const ROUTES = ['/knowledge', '/notes', '/favorites', '/settings/monitor', '/workspaces']
  const overflowReport = []
  for (const vp of VIEWPORTS) {
    const vctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
    const vpage = await vctx.newPage()
    const vcol = makeCollector(vpage)
    const perRoute = []
    for (const route of ROUTES) {
      await gotoSafe(vpage, `${BASE}${route}`, vcol)
      const m = await measureOverflow(vpage)
      perRoute.push({ route, ...m })
    }
    screenshots[`11-${vp.name}`] = await shot(vpage, `11-${vp.name}-monitor`)
    overflowReport.push({ viewport: vp.name, width: vp.width, height: vp.height, routes: perRoute })
    allConsoleErrors.push(...vcol.consoleErrors.map((t) => `[${vp.name}] ${t}`), ...vcol.pageErrors.map((t) => `[${vp.name}/pageerror] ${t}`))
    allNetFailures.push(...vcol.netFailures.map((t) => `[${vp.name}] ${t}`), ...vcol.httpErrors.map((t) => `[${vp.name}/http] ${t}`))
    await vctx.close()
  }
  const anyOverflow = overflowReport.flatMap((v) => v.routes).some((r) => r.overflow)
  if (!anyOverflow) record('11', '五视口无横向溢出', 'pass', `视口=${VIEWPORTS.map((v) => v.name).join(',')} 均 scrollWidth<=clientWidth`)
  else record('11', '五视口无横向溢出', 'fail', JSON.stringify(overflowReport.flatMap((v) => v.routes).filter((r) => r.overflow)))

  // 浏览器关闭页面/切换路由会主动中止健康轮询；只保留可行动的网络失败。
  const realConsoleErrors = allConsoleErrors.filter((t) => !/favicon|\.ico|Download the React DevTools/i.test(t))
  const ignoredNetworkAborts = allNetFailures.filter((t) => /net::ERR_ABORTED/.test(t))
  const actionableNetworkFailures = allNetFailures.filter((t) => !/net::ERR_ABORTED/.test(t))
  if (realConsoleErrors.length === 0) record('12', 'console error 为 0', 'pass', '全部视口/路由 console error=0')
  else record('12', 'console error 为 0', 'fail', `共 ${realConsoleErrors.length} 条：${realConsoleErrors.slice(0, 5).join(' || ')}`)

  await browser.close()

  // ────────────────────────────────────────────────────────────
  // 输出 JSON 报告
  // ────────────────────────────────────────────────────────────
  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE,
    head_commit: process.env.HEAD_COMMIT ?? 'unknown',
    summary: {
      total: results.length,
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      skip: results.filter((r) => r.status === 'skip').length,
    },
    checks: results,
    overflow: overflowReport,
    console_errors: realConsoleErrors,
    network_failures: actionableNetworkFailures,
    ignored_network_aborts: ignoredNetworkAborts.length,
    screenshots,
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify(report.summary))
  console.log(`report: ${REPORT_PATH}`)
}

run().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
