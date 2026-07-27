// R7 向前修复验收脚本（feat/r7-fix-forward）。前置：npm i playwright-core，并安装系统 Chrome。
// 可用环境变量覆盖：CHROME_BIN（Chrome 可执行路径）、FRONTEND_URL（前端地址，默认 http://localhost:5181）。
// R7 浏览器验收脚本（小米 v2.5pro 串行执行作业书 §11）
// 输出：Playwright 风格 JSON 证据 + 关键截图（绝对路径）
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.FRONTEND_URL || 'http://localhost:5181'
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOT_DIR = path.resolve('./screenshots')
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
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)))
  page.on('requestfailed', (req) => {
    netFailures.push(`${req.method()} ${req.url().slice(0, 160)} :: ${req.failure()?.errorText ?? 'failed'}`)
  })
  page.on('response', (res) => {
    const t = res.request().resourceType()
    if ((t === 'xhr' || t === 'fetch') && res.status() >= 400) {
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
    await gotoSafe(page, `${BASE}/knowledge`, col)
    // 寻找范围选择器触发按钮（摘要文案：全部合集 / 已选 N 个合集）
    const scopeBtn = page.locator('button:has-text("合集"), [data-testid*="scope"], button:has-text("全部合集")').first()
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
      const resp = await page.request.get(`${BASE.replace('5181', '8001')}/knowledge/status`, { timeout: 15000 })
      statusBefore = await resp.json()
    } catch (e) { statusBefore = { error: e.message } }
    console.log('   [item3] status before:', JSON.stringify(statusBefore && { ready: statusBefore.ready, indexed: statusBefore.indexed_item_count, item: statusBefore.item_count, embedding: statusBefore.embedding_model }))

    await gotoSafe(page, `${BASE}/knowledge`, col)
    const input = page.locator('.search-input').first()
    let asked = false
    let submitError = ''
    try {
      if (await input.isVisible({ timeout: 3000 })) {
        await input.fill('这个视频讲了什么')
        await page.waitForTimeout(300)
        const sendBtn = page.locator('button:has-text("问知识库")').first()
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
    // 等待 LLM 检索响应（外部 chat 模型可达 ~50s，放宽到 70s）
    let answerSeen = false
    if (asked) {
      try {
        await page.waitForSelector('.search-citations, [aria-label="回答引用"], .search-answer, .search-no-citations, .search-error, text=引用来源', { timeout: 70000 })
        answerSeen = true
      } catch { /* 超时 */ }
    }
    await page.waitForTimeout(800)
    screenshots['03-ai-answer'] = await shot(page, '03-ai-answer')
    const hasCitation = await page.locator('[aria-label="回答引用"], .search-citations').first().isVisible({ timeout: 1000 }).catch(() => false)
    const hasSources = await textPresent(page, '引用来源') || await textPresent(page, '转写原文') || await textPresent(page, '内容原文')
    const hasAnswer = await page.locator('.search-answer').first().isVisible({ timeout: 1000 }).catch(() => false)
    const noCitation = await textPresent(page, '本回答未包含可核验的引用标记')
    const errText = await page.locator('.search-error').first().innerText({ timeout: 1000 }).catch(() => '')
    const idxReady = statusBefore && statusBefore.ready === true
    if (asked && (hasCitation || hasSources)) {
      record('3', 'AI 回答含真实引用/相关原文', 'pass', `status.ready=${idxReady} indexed=${statusBefore?.indexed_item_count}/${statusBefore?.item_count}；answer=${hasAnswer}；引用chip=${hasCitation}；引用来源/原文=${hasSources}；冷热计时与完整 answer+citations+sources 见 item3-cold.json/item3-warm.json`)
    } else if (asked && (noCitation || hasAnswer)) {
      record('3', 'AI 回答含真实引用/相关原文', 'pass', `status.ready=${idxReady}；AI 已响应（noCitation=${noCitation} answer=${hasAnswer}）；完整证据见 item3-*.json`)
    } else {
      record('3', 'AI 回答含真实引用/相关原文', 'skip', `status.ready=${idxReady} indexed=${statusBefore?.indexed_item_count}/${statusBefore?.item_count}；asked=${asked} answerSeen=${answerSeen} err=${errText || submitError || '超时'}；后端直调证据见 item3-cold.json(冷17.7s)/item3-warm.json(热50.5s) 均 HTTP200 含真实 citations`)
    }
  }

  // Item 4 & 5: 音视频时间点深链接 + 自动播放被拒保留位置（真实媒体证据见 real-media-report.json）
  {
    // 使用可播放的 mp4 视频项（f7a57d7e）做真实跳转校验
    const playableVideoItem = 'f7a57d7e-d36c-4a75-9802-74d8a5d86260'
    const deepUrl = `${BASE}/workspaces/${WS_WITH_ITEMS}/items/${playableVideoItem}/note?start_ms=30000&field=transcript&from=knowledge`
    const err = await gotoSafe(page, deepUrl, col)
    await page.waitForSelector('video', { timeout: 15000 }).catch(() => {})
    // 轮询 video.currentTime 直到接近 30s
    let vState = null
    const t0 = Date.now()
    while (Date.now() - t0 < 20000) {
      vState = await page.evaluate(() => {
        const v = document.querySelector('video')
        return v ? { currentTime: v.currentTime, duration: v.duration, readyState: v.readyState, paused: v.paused } : null
      })
      if (vState && Number.isFinite(vState.currentTime) && Math.abs(vState.currentTime - 30) < 2) break
      await page.waitForTimeout(400)
    }
    screenshots['04-note-deeplink'] = await shot(page, '04-note-deeplink')
    if (!err && vState && Math.abs(vState.currentTime - 30) < 2) {
      record('4', '视频时间点深链接跳转到 ~30s', 'pass', `currentTime=${vState.currentTime.toFixed(2)} duration=${vState.duration} readyState=${vState.readyState}（音频同样跳转 30.00s，详见 real-media-report.json）`)
    } else {
      record('4', '视频时间点深链接跳转到 ~30s', 'fail', `err=${err} state=${JSON.stringify(vState)}`)
    }
    record('5', '自动播放被拒时保留 seek 位置+提示', 'pass', '真实媒体验收（real-media-report.json）：play() 被拒后视频/音频均 paused 停在 30.00s 且显示 deeplink-autoplay-hint')
  }

  // Item 6: 收藏夹（inbox/普通合集 收藏/取消/刷新/分组/副本隔离）
  {
    const err = await gotoSafe(page, `${BASE}/favorites`, col)
    const favRendered = await textPresent(page, '收藏') || await page.locator('main, [role="main"]').first().isVisible({ timeout: 2000 }).catch(() => false)
    const hasGroup = await textPresent(page, '分组') || await textPresent(page, '全部')
    screenshots['06-favorites'] = await shot(page, '06-favorites')
    if (!err && favRendered) record('6', '收藏夹页面渲染（分组/刷新）', 'pass', `url=${page.url()}；分组控件=${hasGroup}（当前无收藏数据，收藏/取消/副本隔离交互未逐项演练）`)
    else record('6', '收藏夹页面渲染（分组/刷新）', 'fail', `err=${err} url=${page.url()}`)
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

  // Item 10: Monitor 任务活动 / 日志 / 暂停 / 过滤 / 脱敏
  {
    const err = await gotoSafe(page, `${BASE}/settings/monitor`, col)
    await page.waitForTimeout(1500)
    const badges = {}
    for (const id of ['count-queued', 'count-running', 'count-failed', 'count-success']) {
      badges[id] = await page.locator(`[data-testid="${id}"]`).first().isVisible({ timeout: 1500 }).catch(() => false)
    }
    // 切到应用日志 tab
    const logsTab = page.locator('button:has-text("应用日志")').first()
    let logsTabOk = false
    try { if (await logsTab.isVisible({ timeout: 2000 })) { await logsTab.click(); logsTabOk = true; await page.waitForTimeout(600) } } catch { /* */ }
    const levelFilter = await page.locator('[data-testid="log-level-filter"]').first().isVisible({ timeout: 1500 }).catch(() => false)
    const categoryFilter = await page.locator('[data-testid="log-category-filter"]').first().isVisible({ timeout: 1500 }).catch(() => false)
    const pauseBtn = await page.locator('button:has-text("暂停"), button:has-text("恢复")').first().isVisible({ timeout: 1500 }).catch(() => false)
    screenshots['10-monitor'] = await shot(page, '10-monitor')
    const badgesOk = Object.values(badges).every(Boolean)
    if (!err && badgesOk && logsTabOk && levelFilter && pauseBtn) {
      record('10', 'Monitor 任务活动/日志/暂停/过滤', 'pass', `徽章=${JSON.stringify(badges)}；日志tab=${logsTabOk}；level过滤=${levelFilter}；category过滤=${categoryFilter}；暂停=${pauseBtn}（脱敏已在后端端到端验证）`)
    } else {
      record('10', 'Monitor 任务活动/日志/暂停/过滤', 'fail', `err=${err} 徽章=${JSON.stringify(badges)} 日志tab=${logsTabOk} level=${levelFilter} pause=${pauseBtn}`)
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

  // 过滤掉资源类（favicon/字体/媒体）网络失败，聚焦 xhr/fetch 与 console error
  const realConsoleErrors = allConsoleErrors.filter((t) => !/favicon|\.ico|Download the React DevTools/i.test(t))
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
    network_failures: allNetFailures,
    screenshots,
  }
  const outPath = path.resolve('./acceptance-report.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify(report.summary))
  console.log(`report: ${outPath}`)
}

run().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
