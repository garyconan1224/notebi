# Track K · 带图笔记所见即所得(Milkdown)图片渲染 — 调查卡（已勘误）

> 由 2026-06-16 抖音 E2E 回归测出（用例1 报告 WYSIWYG `img=0`）。2026-06-17 浏览器实锤复核：**非产品 bug，原 `img=0` 为 E2E 断言时机误报**。已归档。
> 状态：**done**（勘误，不改代码）｜ commit `7780f27`

---

## 现象（E2E 原始报告，已勘误）

用例1（抖音·带图）E2E 报告称：所见即所得视图 DOM `img=0`，API `note_body` 含 7 张图片 markdown，推测 Milkdown 未渲染图片。

## 2026-06-17 浏览器复核（结论：非产品 bug）

复核数据：带图 item `45138372-7e8d-4233-9689-9c893495f08a`，wid `0189e82d`（抖音）；交叉验证 `20e532e3`，wid `26965fa0`（B站②）。

| 检查项 | 抖音带图 | B站②带图 |
|---|---|---|
| `.ProseMirror img`（真实图片） | **7** | **4** |
| 图片尺寸（offsetWidth×Height） | 514×289px | 514×289 / 494×278 |
| `rawTextHasBang`（语法变纯文本？） | false | false |
| console error | 无 | 无 |

**结论**：Milkdown 正确渲染所有 `![alt](url)` 为 `<img>` 标签。E2E 初测 `img=0` 是断言时机问题（可能在视图切换/数据加载过程中采样），非产品 bug。已更新 E2E 报告对应条目。

## 目标

带图笔记默认「所见即所得」视图正确把 `![alt](url)` 渲染成 `<img>`，显示数量 = note 实际图片数。

---

## 第 1 步（必做·浏览器实锤根因，别跳过）

> 前提：playwright 可用（`browser_navigate` 打开 `http://localhost:5177`）。不可用立即停下回报，**禁止写脚本绕过**。

打开带图 item 的 note 页：
`http://localhost:5177/workspaces/0189e82d-3dea-4bc8-903f-3300945a539c/items/45138372-7e8d-4233-9689-9c893495f08a/note`

`browser_evaluate` 查 Milkdown 容器里图片到底变成了什么：

```js
() => {
  const pm = document.querySelector('.milkdown .ProseMirror') || document.querySelector('.ProseMirror')
  if (!pm) return JSON.stringify({ error: '没找到 .ProseMirror' })
  return JSON.stringify({
    imgCount: pm.querySelectorAll('img').length,
    // 找含 static 或 !( 的片段，看图片被渲染成 img / 纯文本 / 丢失
    sample: pm.innerHTML.split('\n').filter(l => /static|!\[|<img/.test(l)).slice(0, 4),
    rawTextHasBang: pm.textContent.includes('!['),  // 若 true=图片语法变成了纯文本
  }, null, 2)
}
```

同时 `browser_console_messages level=error` 看 Milkdown 解析有无报错。

**根因分流**（据上面结果判断）：
- `<img>` 存在但 imgCount 与肉眼不符 → 是小米断言时机/选择器问题，**那这其实不是产品 bug**，更新 E2E 报告即可。
- `rawTextHasBang=true`（图片语法变成纯文本 `![]()`）→ **Milkdown 没把 image 解析成节点**，是产品 bug，进第 2 步。
- imgCount=0 且无纯文本 → image 节点被静默丢弃，进第 2 步。

## 第 2 步（根因定位后再选改法）

按第 1 步结果定位为以下哪类，对应修：

| 怀疑根因 | 验证 | 可能改法 |
|---|---|---|
| Milkdown commonmark 未注册 image 渲染 | 查 `MilkdownEditor.tsx` preset 配置；最小复现一个纯 `![](url)` 看渲不渲染 | 补 image 节点支持 / 换 preset 配置 |
| URL 含中文未编码致 remark 解析异常 | 最小复现：ASCII url vs 中文 url 各一张 | note 生成端(`note_assembler`)对图片 url 做 encode，或前端解析前处理 |
| 连续行+行尾两空格 段落结构问题 | 最小复现：图片前后加空行 vs 不加 | `note_assembler` 生成时图片各自独立成段（前后空行） |

> ⚠️ 若改 `backend/app/services/note_assembler.py`：看清影响面（它同时供 source_md/导出），加/改测试，`KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/pytest backend/tests -q` 全绿。

## 🔴 红线

- 第 1 步没在浏览器看到实际 DOM 之前，**不要动手改任何代码**。
- 仓库其它未提交改动若有，commit 时只 `git add` 本次相关文件，禁止 `git add -A`。
- 不确定根因属于哪类就回报 Claude 桌面，别瞎改 Milkdown 配置。

## 验证（修复后）

```bash
cd /Users/conan/Desktop/nibi/frontend && npm run build
```
playwright 重开带图 note 页，`browser_evaluate` 确认 `.ProseMirror img` 数量 = note 图片数（本例 7）。截图存证。

## 完成后回报

1. 第 1 步 DOM 实测结果（imgCount / 是否变纯文本 / console 报错）；
2. 定位的根因类型 + 采用的改法；
3. build 结果 + 修复后 img 数；
4. 若结论是「小米断言错、产品无 bug」，则改为更新 E2E 报告那一条，不改代码。
