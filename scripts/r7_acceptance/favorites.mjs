// R7 向前修复验收脚本（feat/r7-fix-forward）。前置：npm i playwright-core，并安装系统 Chrome。
// 可用环境变量覆盖：CHROME_BIN（Chrome 可执行路径）、FRONTEND_URL（前端地址，默认 http://localhost:5181）。
// R7 收藏夹实战演练：渲染 / 分组（副本隔离）/ 刷新 / 取消收藏
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.FRONTEND_URL || 'http://localhost:5181'
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOT_DIR = path.resolve('./screenshots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

const results = []
function record(item, status, detail) {
  results.push({ item, status, detail })
  console.log(`${status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️'} ${item} :: ${detail}`)
}

async function snapshotCards(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.note-card'))
    return cards.map((c) => ({
      name: c.querySelector('h3')?.textContent?.trim() ?? '',
      ws: c.querySelector('.note-summary')?.textContent?.trim() ?? '',
    }))
  })
}

async function run() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })

  await page.goto(`${BASE}/favorites`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('.note-card, .empty-state', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)

  // 1. 渲染
  let cards = await snapshotCards(page)
  await page.screenshot({ path: path.join(SHOT_DIR, 'fav-01-initial.png') })
  if (cards.length > 0) record('收藏夹渲染收藏卡片', 'pass', `卡片数=${cards.length}`)
  else record('收藏夹渲染收藏卡片', 'fail', '无卡片')

  // 2. 分组 / 副本隔离：workspace_name 同时出现 收纳箱(__inbox__) 与真实合集
  const wsNames = Array.from(new Set(cards.map((c) => c.ws)))
  const hasInbox = wsNames.some((n) => n.includes('收纳箱'))
  const hasNormal = wsNames.some((n) => n && !n.includes('收纳箱'))
  if (hasInbox && hasNormal) {
    record('副本隔离：收纳箱与普通合集收藏并存解析', 'pass', `来源合集=${wsNames.join(' | ')}`)
  } else {
    record('副本隔离：收纳箱与普通合集收藏并存解析', 'fail', `来源合集=${wsNames.join(' | ')}`)
  }

  // 3. 刷新
  const refreshBtn = page.locator('button:has-text("刷新")').first()
  let refreshOk = false
  try {
    if (await refreshBtn.isVisible({ timeout: 2000 })) { await refreshBtn.click(); refreshOk = true; await page.waitForTimeout(1200) }
  } catch { /* */ }
  const cardsAfterRefresh = await snapshotCards(page)
  if (refreshOk && cardsAfterRefresh.length === cards.length) {
    record('刷新后收藏列表保持一致', 'pass', `刷新前=${cards.length} 刷新后=${cardsAfterRefresh.length}`)
  } else {
    record('刷新后收藏列表保持一致', 'fail', `refreshOk=${refreshOk} 前=${cards.length} 后=${cardsAfterRefresh.length}`)
  }

  // 4. 分组筛选控件存在
  const groupControl = await page.locator('.fav-header-actions select, [class*="group"] select, select').first().isVisible({ timeout: 2000 }).catch(() => false)
  record('分组筛选控件存在', groupControl ? 'pass' : 'skip', `分组下拉=${groupControl}`)

  // 5. 取消收藏：点击第一个“取消收藏”按钮，验证卡片数 -1
  const before = (await snapshotCards(page)).length
  const unfavBtn = page.locator('[title="取消收藏"]').first()
  let unfavClicked = false
  try {
    if (await unfavBtn.isVisible({ timeout: 2000 })) { await unfavBtn.click(); unfavClicked = true }
  } catch { /* */ }
  await page.waitForTimeout(1500)
  const after = (await snapshotCards(page)).length
  await page.screenshot({ path: path.join(SHOT_DIR, 'fav-02-after-unfavorite.png') })
  if (unfavClicked && after === before - 1) {
    record('取消收藏即时移除卡片', 'pass', `取消前=${before} 取消后=${after}`)
  } else {
    record('取消收藏即时移除卡片', 'fail', `clicked=${unfavClicked} 前=${before} 后=${after}`)
  }

  await browser.close()
  const report = {
    generated_at: new Date().toISOString(),
    checks: results,
    console_errors: consoleErrors,
    screenshots: {
      initial: path.join(SHOT_DIR, 'fav-01-initial.png'),
      afterUnfavorite: path.join(SHOT_DIR, 'fav-02-after-unfavorite.png'),
    },
  }
  fs.writeFileSync(path.resolve('./favorites-report.json'), JSON.stringify(report, null, 2))
  console.log('\nSUMMARY', JSON.stringify({
    pass: results.filter(r => r.status === 'pass').length,
    fail: results.filter(r => r.status === 'fail').length,
    skip: results.filter(r => r.status === 'skip').length,
    consoleErrors: consoleErrors.length,
  }))
}

run().catch((e) => { console.error('FATAL', e); process.exit(1) })
