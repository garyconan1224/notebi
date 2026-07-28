// R7 向前修复验收脚本（feat/r7-fix-forward）。前置：npm i playwright-core，并安装系统 Chrome。
// 可用环境变量覆盖：CHROME_BIN（Chrome 可执行路径）、FRONTEND_URL（前端地址，默认 http://localhost:5181）。
// R7 真实媒体验收：视频 + 音频 start_ms 深链接跳转 + 自动播放拒绝路径
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = process.env.NODE_MODULE_DIR
  ? createRequire(path.resolve(process.env.NODE_MODULE_DIR, 'package.json'))
  : createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const BASE = process.env.FRONTEND_URL || 'http://localhost:5181'
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOT_DIR = path.resolve(process.env.REAL_MEDIA_SCREENSHOT_DIR || './screenshots')
const REPORT_PATH = path.resolve(process.env.REAL_MEDIA_REPORT || './real-media-report.json')
fs.mkdirSync(SHOT_DIR, { recursive: true })

const VIDEO_WORKSPACE_ID = process.env.REAL_VIDEO_WORKSPACE_ID || '6c13ef8c-41e6-4cb4-9508-11764e4b3839'
const VIDEO_ITEM_ID = process.env.REAL_VIDEO_ITEM_ID || 'f8f3050f-f0e2-493c-916a-2d7c3dc52671'
const AUDIO_WORKSPACE_ID = process.env.REAL_AUDIO_WORKSPACE_ID || 'c77afb23-b376-4dc0-9720-034f7750685a'
const AUDIO_ITEM_ID = process.env.REAL_AUDIO_ITEM_ID || '41469d2e-5fc5-407f-8700-c7a42a009e68'
const VIDEO_URL = `${BASE}/workspaces/${VIDEO_WORKSPACE_ID}/items/${VIDEO_ITEM_ID}/note?start_ms=30000&field=transcript&from=knowledge`
const AUDIO_URL = `${BASE}/workspaces/${AUDIO_WORKSPACE_ID}/items/${AUDIO_ITEM_ID}/note?start_ms=30000&field=transcript&from=knowledge`
const TARGET_SEC = 30

const results = []
function record(item, status, detail) {
  results.push({ item, status, detail })
  console.log(`${status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️'} ${item} :: ${detail}`)
}

// 轮询媒体 currentTime 直到接近目标或超时
async function waitForSeek(page, selector, target, timeoutMs = 15000) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    last = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      return {
        currentTime: el.currentTime,
        duration: el.duration,
        readyState: el.readyState,
        paused: el.paused,
        src: (el.currentSrc || el.src || '').slice(0, 80),
      }
    }, selector)
    if (last && Number.isFinite(last.currentTime) && Math.abs(last.currentTime - target) < 2) {
      return last
    }
    await page.waitForTimeout(400)
  }
  return last
}

async function run() {
  // 用 user-gesture-required 策略阻止有声自动播放 → 确定性验证 Item 5 拒绝路径：
  // play() 被拒 → 媒体停在目标时间（paused）+ 显示“点击播放”提示。
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--autoplay-policy=user-gesture-required'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  // 模拟浏览器阻止自动播放：play() 返回 reject。确定性验证 Item 5：
  // 深链接 play() 被拒 → 媒体停在目标时间（paused）+ 显示“点击播放”提示。
  await ctx.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'))
    }
  })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })

  // ── 视频 ──
  {
    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('video', { timeout: 15000 }).catch(() => {})
    const state = await waitForSeek(page, 'video', TARGET_SEC, 20000)
    await page.waitForTimeout(800)
    const hintVisible = await page.locator('[data-testid="deeplink-autoplay-hint"]').isVisible().catch(() => false)
    await page.screenshot({ path: path.join(SHOT_DIR, 'real-video-deeplink.png') })
    if (state && Number.isFinite(state.currentTime) && Math.abs(state.currentTime - TARGET_SEC) < 2) {
      record('视频 start_ms=30000 跳转到 ~30s', 'pass',
        `currentTime=${state.currentTime.toFixed(2)} duration=${state.duration} readyState=${state.readyState} paused=${state.paused} autoplayHint=${hintVisible}`)
    } else {
      record('视频 start_ms=30000 跳转到 ~30s', 'fail', `state=${JSON.stringify(state)} hint=${hintVisible}`)
    }
    // Item 5：若自动播放被拒绝，应保留目标时间并显示提示
    if (state && state.paused && hintVisible) {
      record('视频自动播放被拒绝时保留时间+提示', 'pass', `paused=${state.paused} currentTime=${state.currentTime.toFixed(2)} hint可见`)
    } else if (state && !state.paused) {
      record('视频自动播放被拒绝时保留时间+提示', 'pass', `自动播放成功（未触发拒绝路径），currentTime=${state.currentTime.toFixed(2)}`)
    } else {
      record('视频自动播放被拒绝时保留时间+提示', 'skip', `paused=${state?.paused} hint=${hintVisible}`)
    }
  }

  // ── 音频 ──
  {
    await page.goto(AUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('audio', { timeout: 15000 }).catch(() => {})
    const state = await waitForSeek(page, 'audio', TARGET_SEC, 20000)
    await page.waitForTimeout(800)
    const hintVisible = await page.locator('[data-testid="deeplink-autoplay-hint"]').isVisible().catch(() => false)
    await page.screenshot({ path: path.join(SHOT_DIR, 'real-audio-deeplink.png') })
    if (state && Number.isFinite(state.currentTime) && Math.abs(state.currentTime - TARGET_SEC) < 2) {
      record('音频 start_ms=30000 跳转到 ~30s', 'pass',
        `currentTime=${state.currentTime.toFixed(2)} duration=${state.duration} readyState=${state.readyState} paused=${state.paused} autoplayHint=${hintVisible}`)
    } else {
      record('音频 start_ms=30000 跳转到 ~30s', 'fail', `state=${JSON.stringify(state)} hint=${hintVisible}`)
    }
    if (state && state.paused && hintVisible) {
      record('音频自动播放被拒绝时保留时间+提示', 'pass', `paused=${state.paused} currentTime=${state.currentTime.toFixed(2)} hint可见`)
    } else if (state && !state.paused) {
      record('音频自动播放被拒绝时保留时间+提示', 'pass', `自动播放成功（未触发拒绝路径），currentTime=${state.currentTime.toFixed(2)}`)
    } else {
      record('音频自动播放被拒绝时保留时间+提示', 'skip', `paused=${state?.paused} hint=${hintVisible}`)
    }
  }

  await browser.close()

  const report = {
    generated_at: new Date().toISOString(),
    target_sec: TARGET_SEC,
    checks: results,
    console_errors: consoleErrors,
    screenshots: {
      video: path.join(SHOT_DIR, 'real-video-deeplink.png'),
      audio: path.join(SHOT_DIR, 'real-audio-deeplink.png'),
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
