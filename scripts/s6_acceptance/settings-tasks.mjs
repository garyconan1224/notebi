import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = process.env.NODE_MODULE_DIR
  ? createRequire(path.resolve(process.env.NODE_MODULE_DIR, 'package.json'))
  : createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const frontend = process.env.FRONTEND_URL || 'http://127.0.0.1:5181'
const backend = process.env.BACKEND_URL || 'http://127.0.0.1:8001'
const output = path.resolve(
  process.env.SETTINGS_TASKS_REPORT
    || './scripts/s6_acceptance/evidence/settings-tasks-report.json',
)
const chrome = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const checks = []
const record = (name, passed, detail) => {
  checks.push({ name, status: passed ? 'pass' : 'fail', detail })
  console.log(`${passed ? '✅' : '❌'} ${name} :: ${detail}`)
}

const visibleText = async (page, text) => (
  page.getByText(text, { exact: false }).first().isVisible().catch(() => false)
)

const waitForVisibleText = async (page, text) => {
  const locator = page.getByText(text, { exact: false }).first()
  await locator.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  return locator.isVisible().catch(() => false)
}

const clickSave = async (page) => {
  const save = page.getByRole('button', { name: /^保存$/ }).last()
  await save.waitFor({ state: 'visible', timeout: 5000 })
  await save.click()
  await page.waitForTimeout(600)
}

const browser = await chromium.launch({ executablePath: chrome, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', message => {
  if (message.type() === 'error') {
    const location = message.location()
    consoleErrors.push(
      `${message.text()}${location?.url ? ` @ ${location.url}` : ''}`,
    )
  }
})

// Network: browser save -> backend readback -> browser refresh.
await page.goto(`${frontend}/settings/network`, { waitUntil: 'domcontentloaded' })
await page.getByText('网络设置', { exact: true }).waitFor()
const networkBeforeResponse = await context.request.get(`${backend}/network_config`)
const networkBefore = await networkBeforeResponse.json()
const nextRoutingMode = networkBefore.routing_mode === 'direct' ? 'smart' : 'direct'
const nextRoutingLabel = nextRoutingMode === 'direct' ? /全部直连/ : /智能分流/
await page.getByRole('radio', { name: nextRoutingLabel }).check()
await page.getByLabel('代理地址').fill('')
await clickSave(page)
const networkReadback = await context.request.get(`${backend}/network_config`)
const network = await networkReadback.json()
await page.reload({ waitUntil: 'domcontentloaded' })
await page.getByText('网络设置', { exact: true }).waitFor()
const networkPersisted = await page.getByRole('radio', { name: nextRoutingLabel }).isChecked()
  && await page.getByLabel('代理地址').inputValue() === ''
record(
  '网络设置保存、GET 读回、刷新一致',
  networkReadback.ok()
    && network.routing_mode === nextRoutingMode
    && networkPersisted,
  `HTTP=${networkReadback.status()} routing_mode=${network.routing_mode} refresh=${networkPersisted}`,
)
const networkDeprecated = ['po_token', 'visitor_data', 'cookie_base_dirs']
  .filter(key => Object.hasOwn(network, key))
record(
  '网络响应不序列化废弃字段',
  networkDeprecated.length === 0,
  networkDeprecated.length ? `仍有 ${networkDeprecated.join(',')}` : '废弃字段均不存在',
)
record(
  '网络用途说明和四个测试入口常驻',
  await visibleText(page, '智能路由规则')
    && await visibleText(page, '测试 Bilibili')
    && await visibleText(page, '测试 YouTube')
    && await visibleText(page, '测试 Tavily')
    && await visibleText(page, '测试模型服务'),
  '智能分流、代理规则和实际目标测试可见',
)

// Download/Cookie: browser save -> backend readback -> browser refresh.
await page.goto(`${frontend}/settings/download`, { waitUntil: 'domcontentloaded' })
await page.getByText('下载配置', { exact: true }).waitFor()
const concurrency = page.getByLabel('并发下载数')
const previousConcurrency = Number(await concurrency.inputValue())
const nextConcurrency = previousConcurrency === 3 ? 4 : 3
await concurrency.fill(String(nextConcurrency))
await clickSave(page)
const downloadReadback = await context.request.get(`${backend}/download_config`)
const download = await downloadReadback.json()
await page.reload({ waitUntil: 'domcontentloaded' })
await page.getByText('下载配置', { exact: true }).waitFor()
const downloadPersisted = Number(
  await page.getByLabel('并发下载数').inputValue(),
) === nextConcurrency
record(
  '下载设置保存、GET 读回、刷新一致',
  downloadReadback.ok()
    && download.concurrency_limit === nextConcurrency
    && downloadPersisted,
  `HTTP=${downloadReadback.status()} concurrency=${download.concurrency_limit} refresh=${downloadPersisted}`,
)
const downloadDeprecated = ['po_token', 'visitor_data', 'cookie_base_dirs']
  .filter(key => Object.hasOwn(download, key))
record(
  '下载响应不序列化废弃字段',
  downloadDeprecated.length === 0,
  downloadDeprecated.length ? `仍有 ${downloadDeprecated.join(',')}` : '废弃字段均不存在',
)
record(
  'Cookie 教程和操作入口完整',
  await visibleText(page, '关闭浏览器后再测试')
    && await visibleText(page, 'Netscape 格式')
    && await page.getByRole('button', { name: '测试 Cookie' }).isVisible()
    && await page.getByLabel('导入 cookies.txt').isVisible()
    && await page.getByRole('button', { name: '删除 Cookie 文件' }).isVisible(),
  '测试、导入、删除及安全说明均可见',
)

// Unified task center and collection workspace.
await page.goto(`${frontend}/tasks`, { waitUntil: 'domcontentloaded' })
const newBatchLink = page.getByRole('link', { name: '新建批量任务' })
await newBatchLink.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
record(
  '统一任务中心入口',
  await newBatchLink.isVisible().catch(() => false),
  '批量任务和单条任务共用 /tasks',
)
await page.goto(`${frontend}/tasks/new`, { waitUntil: 'domcontentloaded' })
record(
  '批量任务创建页默认笔记语义',
  await waitForVisibleText(page, '新建批量任务')
    && !await visibleText(page, '学习笔记'),
  '创建页可用且没有恢复已删除的学习笔记 action',
)

await page.goto(
  `${frontend}/workspaces/6c13ef8c-41e6-4cb4-9508-11764e4b3839`,
  { waitUntil: 'domcontentloaded' },
)
record(
  '合集工作台真实路由',
  page.url().includes('/workspaces/6c13ef8c-41e6-4cb4-9508-11764e4b3839')
    && await waitForVisibleText(page, '新笔记合集'),
  `url=${page.url()}`,
)

record(
  '设置与任务中心 console error 为 0',
  consoleErrors.length === 0,
  consoleErrors.length ? consoleErrors.slice(0, 5).join(' || ') : 'console error=0',
)

await browser.close()
const report = {
  generated_at: new Date().toISOString(),
  frontend,
  backend,
  summary: {
    total: checks.length,
    pass: checks.filter(check => check.status === 'pass').length,
    fail: checks.filter(check => check.status === 'fail').length,
  },
  checks,
  console_errors: consoleErrors,
}
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.summary))
if (report.summary.fail) process.exitCode = 1
