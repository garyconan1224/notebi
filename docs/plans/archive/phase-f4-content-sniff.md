---
name: phase-f4-content-sniff
description: F4 内容类型自动识别——URL 嗅探替代手动指定 type，混合内容自动拆多 item
status: ready
created_date: 2026-05-22
model: deepseek v4-pro（F4.1/F4.2/F4.4）；F4.3 复杂时升 Opus
branch: feat/f4-content-sniff
commits: []
completed_date: ~
actual_hours: ~
---

# F4 内容类型自动识别 — 详细执行计划

> **前置**：F3 错误体验优化（非阻塞——F4 可以在 F3 之前独立做）
> **目标**：把"创建 item 必须手动指定 type"升级为"URL 先嗅探内容类型，再创建正确 item；混合内容可拆多个 item"
> **约束**：不改 schema / 不改任务状态机 / 不破坏显式 type 旧接口 / 不混入 F2 冒烟 bug 修

---

## 1. 问题现状

### 1.1 当前硬编码行为

`PreflightDrawer.tsx:154` 创建 item 时 **type 固定写死为 `'video'`**：

```typescript
// frontend/src/pages/WorkbenchPage/PreflightDrawer.tsx:152-158
const itemRes = await addWorkspaceItem(wsId, {
  type: 'video',       // ← 永远 video，无论实际内容
  source: 'url',
  source_value: url,
  name: url.split('/').pop()?.split('?')[0] || url,
})
```

同样，`PreflightDrawer.tsx:178-179` 的 preflight tasks 构建也是"未传 selectedTypes 时按 video 处理"：

```typescript
// PreflightDrawer.tsx:180
const isVideo = !selectedTypes?.length || selectedTypes.some(...)
```

### 1.2 后果

| 场景 | 实际内容类型 | 当前行为 | 问题 |
|---|---|---|---|
| B站专栏文章 URL | text/article | 创建 `type: 'video'` 的 item | item type 与内容不匹配，后续 pipeline 走错分支 |
| 通用网页 URL | text | 同上 | 同上 |
| 小红书图文 URL | image + text | `detectPlatform` 标记为 `['video', 'image', 'article']`，走混合弹窗 | 弹窗让用户选，但选完后还是只创建一个 item（type 仍是 `'video'`） |
| 图片直链 URL | image | 创建 `type: 'video'` | 完全不匹配 |

### 1.3 SPEC 对照

SPEC 模块 2.1 明确要求：

> 用户**粘贴 URL 后**，系统自动识别平台和内容类型，**自动回填 ① 素材类型**（用户不用先选）

SPEC 模块 2.2 链接处理流程：

> 内容类型检测
>   ├─ 单一类型（纯视频/纯文章）→ 自动回填素材类型，继续
>   └─ 混合类型（如 B 站视频可下视频/音频/同时）→ 弹窗让用户选下载哪些

**SPEC 与现有代码的差距**：`detectPlatform()` 只做域名→平台映射，返回的是"平台支持的类型列表"而非"这个具体 URL 包含什么内容"。真正的"内容类型检测"从未实现。

---

## 2. 分阶段方案

### F4.1 最小嗅探 —— 后端 URL 嗅探端点（估时 3-4h）

**目标**：后端新增一个轻量嗅探端点，不下载实际内容，仅基于 HTTP 响应头 + URL 路径模式推断内容类型。

**新增文件**：

1. `shared/url_sniffer.py`（~120 行）
   - `sniff_url(url: str) -> SniffResult` 主函数
   - 策略 1（静态路径模式）：对已知平台做 URL path 正则匹配
     - B站：`/video/BV...` → video；`/read/...` → article；`/audio/...` → audio
     - 小红书：`/discovery/item/` → image+article；`/explore/` → image+article
     - 微信公众号：`/s/` → article
     - YouTube：`/watch` / `/shorts/` → video
   - 策略 2（HTTP HEAD → Content-Type）：对非已知平台或无法从 URL 判断的，发一个 HEAD 请求
     - `video/*` → video
     - `audio/*` → audio
     - `image/*` → image
     - `text/html` → 发 GET 读前 64KB，用 opengraph meta (`og:type`, `og:video`, `og:image`) 二次判断
     - `application/pdf` → text
   - 策略 3（fallback）：HEAD 也失败时，按平台预定义默认值兜底
   - 返回数据结构：
     ```python
     @dataclass
     class SniffResult:
         primary_type: str       # "video" | "audio" | "image" | "text"
         possible_types: list[str]  # 混合内容时可能有多个
         platform: str | None    # 平台名，无匹配则为 None
         title: str | None       # 从 og:title / <title> 提取，无可为 None
         thumbnail: str | None   # 从 og:image 提取
         content_type_header: str | None  # HTTP Content-Type 原值
     ```

2. **后端路由注册**（选轻方案——挂在 `/workspaces` 下，不新增独立 router 文件）：
   - `backend/app/routes/workspaces.py` 新增一个 `POST /workspaces/sniff-url` 端点
   - Pydantic 请求：
     ```python
     class SniffUrlRequest(BaseModel):
         url: str = Field(min_length=1, description="待嗅探的 URL")
     ```
   - 响应：`SniffResult` 直接 dict 返回
   - 实现：调用 `shared/url_sniffer.sniff_url()`，错误时返回 `{"error": "..."}` + 200（不抛异常，让前端有 fallback 路径）

3. **前端服务层**：
   - `frontend/src/services/workspaces.ts` 新增 `sniffUrl(url: string): Promise<SniffResult>`

**改动文件**（共 3 个）：
| 文件 | 改动类型 | 说明 |
|---|---|---|
| `shared/url_sniffer.py` | **新增** | 嗅探核心逻辑 |
| `backend/app/routes/workspaces.py` | 新增 1 个端点 | `POST /workspaces/sniff-url` |
| `frontend/src/services/workspaces.ts` | 新增 1 个函数 | `sniffUrl()` |

**模型分配**：⭐ deepseek v4-pro（单文件新增 + 单端点 + 前端一个函数，难度低）

**验收标准**：
- `curl -X POST localhost:8000/workspaces/sniff-url -d '{"url":"https://www.bilibili.com/video/BV1qA5j6jEJC"}'` 返回 `primary_type: "video"`
- `curl ... -d '{"url":"https://www.bilibili.com/read/cv12345678"}'` 返回 `primary_type: "text"`
- 通用网页（如某篇 Medium 文章）HEAD 嗅探返回 `primary_type: "text"`
- 图片直链 HEAD 嗅探返回 `primary_type: "image"`
- 新增后端 pytest：至少 5 个 case（B站视频 / B站专栏 / YouTube / 微信公众号 / 图片直链 / 未知域名通用网页）

---

### F4.2 前端接入 —— Composer + PreflightDrawer 自动填类型（估时 2-3h）

**目标**：前端在用户粘贴 URL 后调用嗅探，自动回填 item type；仍保留手动覆盖入口。

**改动文件**（共 2 个）：

| 文件 | 改动 | 说明 |
|---|---|---|
| `frontend/src/pages/WorkbenchPage/Composer.tsx` | 约 +30 行 | URL 输入框 onBlur / debounce 500ms 后调用 sniffUrl；把结果存入 state 传给 PreflightDrawer |
| `frontend/src/pages/WorkbenchPage/PreflightDrawer.tsx` | 约 +15 行 | 用 sniffResult.primary_type 替代硬编码 `'video'`；未拿到 sniff 结果时用 `detectPlatform` 的第一个 type 兜底 |

**具体改动**：

1. **Composer.tsx**：
   - 新增状态：`const [sniffResult, setSniffResult] = useState<SniffResult | null>(null)`
   - 新增 `useEffect`：对 `normalizedUrl` 做 debounce 500ms，调用 `sniffUrl(normalizedUrl)`，结果写入 `sniffResult`
   - `sniffResult` 通过 props 传给 `PreflightDrawer`
   - 如果 `sniffResult` 为 null（嗅探中或嗅探失败），PreflightDrawer 的行为和现在完全一致（fallback）

2. **PreflightDrawer.tsx**：
   - 新增 prop：`sniffResult?: SniffResult`
   - `handleConfirm` 中的 `type: 'video'` 改为：
     ```typescript
     const itemType = sniffResult?.primary_type
       ?? (platformName ? detectPlatform(url)?.types[0] : null)
       ?? 'video'
     ```
   - 混合内容场景（`sniffResult.possible_types.length > 1`）的处理留给 F4.3

**关键兼容性保证**：
- `ItemAddRequest.type` 字段**仍然是必填**（不改 schema）
- `addWorkspaceItem` 的 API 签名**完全不变**
- `sniffResult` 为 null 时，行为退化为当前的 `type: 'video'` 硬编码——**旧接口零破坏**
- 用户仍然可以手动在 Composer 里选类型（如果以后加了类型选择器的话）

**模型分配**：⭐ deepseek v4-pro（前端组件改动，不涉及状态机）

**验收标准**：
- 粘贴 B站视频 URL → PreflightDrawer 自动以 `type='video'` 创建 item → pipeline 走 `_bridge_to_pipeline_payload` 的 video 分支
- 粘贴微信公众号文章 URL → 自动以 `type='text'` 创建 item → pipeline 走 text 分支
- 嗅探失败（网络不通 / 超时）→ 退化为 `type='video'` → 不报错，能继续提交
- 用户体验：URL 粘贴后 500ms 内就能看到平台识别结果（不等待嗅探结果即可点"开始解析"）

---

### F4.3 混合内容拆 item —— 一个 URL 创建多个 item（估时 3-4h）

**目标**：当嗅探返回多个 `possible_types` 时，PreflightDrawer 一次提交创建多个 item，每个 item 对应一种内容类型。

**触发条件**：
- `sniffResult.possible_types.length > 1`
- 同时 `selectedTypes` prop 为 undefined 或长度 > 1（F4.3 之前，`selectedTypes` 由 MixedContentModal 传入）

**改动文件**（共 1 个）：

| 文件 | 改动 | 说明 |
|---|---|---|
| `frontend/src/pages/WorkbenchPage/PreflightDrawer.tsx` | 约 +40 行 | `handleConfirm` 改为循环创建多个 item |

**具体改动**：

`handleConfirm` 核心逻辑从：

```typescript
// 当前：创建 1 个 item
const itemRes = await addWorkspaceItem(wsId, { type: 'video', ... })
```

改为：

```typescript
// F4.3：按 types 列表创建 N 个 item
const typesToCreate = selectedTypes?.length
  ? selectedTypes.map(类型名→ItemType值)  // 用户手动选的
  : sniffResult?.possible_types?.length
    ? sniffResult.possible_types           // 嗅探结果
    : ['video']                            // fallback

for (const itemType of typesToCreate) {
  const itemRes = await addWorkspaceItem(wsId, {
    type: itemType,
    source: 'url',
    source_value: url,
    name: `${derivedName} (${typeLabel(itemType)})`,  // 加后缀区分，如 "BV... (视频)"
  })
  // 每个 item 独立保存 preflight + start pipeline
  await savePreflight(wsId, itemId, { ... })
  await startItemPipeline(wsId, itemId)
}
```

**preflight 分工**：
- 同一 URL 拆出的多个 item **共享**：背景信息（contentType / purpose / topic）、模型选择（vision / text model）
- **不共享**：tasks——每个 item 按自己的 type 构建不同的 tasks（视频有 summary path；音频有 ASR；文字有 summary/rewrite）

**单次提交 toast 策略**：
- 成功：`toast.success('已创建 N 个素材')`
- 部分失败：`toast.warning('已创建 X/N 个素材，Y 个失败')`——逐个显示失败原因

**兼容性**：
- `selectedTypes` 如果长度 = 1（用户通过 MixedContentModal 只选了 1 种），则只创建 1 个 item，行为=F4.2
- `sniffResult` 为 null 时，退化为创建 1 个 `type='video'` item，行为=当前

**模型分配**：如果 typesToCreate ≤ 3 且逻辑不超 50 行 → ⭐ deepseek v4-pro；如果循环内涉及复杂 preflight 分支（4 种 type 的 task 构建各不相同）→ 升 Opus 4.7

**验收标准**：
- B站视频 URL（sniff 返回 `possible_types: ['video', 'audio']`）→ 创建 2 个 item：一个 video + 一个 audio
- 小红书图文 URL（sniff 返回 `['image', 'text']`）→ 创建 2 个 item
- 纯视频 URL（possible_types 只有 1 个）→ 只创建 1 个 item，不弹多余弹窗
- 创建失败 1 个时，另一个仍成功创建，toast 显示"已创建 1/2 个素材"

---

### F4.4 回归测试（估时 1-2h）

**后端测试（新增文件）**：

`tests/backend/test_url_sniffer.py`——至少覆盖：

| Case | 输入 URL | 预期 primary_type |
|---|---|---|
| B站视频 | `https://www.bilibili.com/video/BV1xx` | `video` |
| B站专栏 | `https://www.bilibili.com/read/cv12345` | `text` |
| YouTube | `https://www.youtube.com/watch?v=dQw4w9WgXcQ` | `video` |
| 微信公众号 | `https://mp.weixin.qq.com/s/xxxx` | `text` |
| 图片直链 | `https://example.com/photo.jpg` | `image` |
| 通用网页 | `https://example.com/blog/post-1` | `text` |
| 未知域名无 HEAD | `https://unknown-xyz.example/foo` | `video`（fallback） |

**前端测试（已有 vitest + `tests/frontend/url.test.ts`）**：
- 新增 `sniffUrl` mock case：mock 返回 video→PreflightDrawer 创建 item type 为 'video'
- 新增 fallback case：sniff 失败→退化 type 为 'video'
- F4.3 多 item case：sniff 返回 2 types→`addWorkspaceItem` 被调用 2 次

**手动冒烟（浏览器）**：
- 粘贴 B站视频 URL → 自动识别为 video → 提交 → pipeline 正常 → Results 页正常
- 粘贴微信公众号 URL → 自动识别为 text → 提交 → text pipeline 启动
- 粘贴图片直链 → 自动识别为 image → 提交 → image pipeline 启动

**模型分配**：⭐ deepseek v4-pro（写测试模板 + 跑验证）

---

## 3. API 契约草案

### 3.1 `POST /workspaces/sniff-url`

```
Request:
{
  "url": "https://www.bilibili.com/video/BV1qA5j6jEJC/"
}

Response (200):
{
  "primary_type": "video",
  "possible_types": ["video"],
  "platform": "bilibili",
  "title": "某视频标题",
  "thumbnail": "https://i0.hdslb.com/...",
  "content_type_header": "text/html"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `primary_type` | `"video" \| "audio" \| "image" \| "text"` | 是 | 最可能的内容类型（用于 item.type） |
| `possible_types` | `string[]` | 是 | 所有可能的内容类型（用于混合内容判断）；单类型时数组长度=1 |
| `platform` | `string \| null` | 是 | 平台名（bilibili/youtube/xiaohongshu 等），无匹配为 null |
| `title` | `string \| null` | 否 | 从 og:title / <title> 提取的标题 |
| `thumbnail` | `string \| null` | 否 | 从 og:image 提取的缩略图 URL |
| `content_type_header` | `string \| null` | 否 | HTTP Content-Type 响应头原值（调试用） |

### 3.2 前端 TypeScript 类型

```typescript
// frontend/src/services/workspaces.ts
interface SniffResult {
  primary_type: 'video' | 'audio' | 'image' | 'text'
  possible_types: string[]
  platform: string | null
  title: string | null
  thumbnail: string | null
  content_type_header: string | null
}

async function sniffUrl(url: string): Promise<SniffResult>
```

### 3.3 不改的接口

- `POST /workspaces/{id}/items` (`ItemAddRequest`)——**type 保持必填**，前端负责根据 sniff 结果填入正确值
- `POST /workspaces/{id}/items/{item_id}/start`——签名不变
- `PUT /workspaces/{id}/items/{item_id}/preflight` (`PreflightSaveRequest`)——签名不变

---

## 4. 不做范围（明确排除）

| 排除项 | 原因 |
|---|---|
| 下载文件并解析内容来确定类型 | 太贵太慢，违背"嗅探"的轻量定位 |
| 修改 `ItemAddRequest.type` 为 optional | 不改 schema——前端自动填值即可 |
| B站空间 / 播放列表 URL 展开 | 那是 F5 或单独的 URL 批量处理功能 |
| 本地文件的 magic bytes 自动识别 | 本地文件上传已有 `_EXTENSION_TYPE_MAP` + `_infer_upload_item_type`，不在 F4 范围 |
| 混合内容创建后自动触发不同的 pipeline 路径依赖 | pipeline 已有每种 type 的 `_bridge_to_pipeline_payload` 分支，无需额外工作 |
| 修改 `platforms.ts` 里的 PLATFORMS 定义 | 当前定义是"平台能力"，不是"URL 内容类型"，职责不同 |
| 嗅探缓存 / 去重 | 轻量 HEAD 请求足够快，暂不需要 |

---

## 5. 升 Opus 条件

在 F4.1 或 F4.3 执行过程中，以下任一条件触发时**切换模型到 Opus 4.7**：

1. `shared/url_sniffer.py` 的平台路径正则 > 5 个平台，逻辑分支超过 4 层（URL 模式→HTTP HEAD→OG meta→fallback），复杂度超过 DS 能力
2. F4.3 多 item 创建需要处理 **4 种 type × 各自 preflight tasks 分支**（video 的 summary path + audio 的 ASR/voiceprint + image 的 OCR/prompt + text 的 summary/rewrite），循环体超 50 行
3. 用户要求把嗅探和 item 创建包装成一个**原子事务**（全部成功或全部回滚），涉及 workspace store 的事务性操作
4. HTTP HEAD 请求遇到重定向链 / CDN 边缘 case 需要做复杂的 Content-Type 推断（MIME sniffing 安全策略）
5. 跨文件改动 ≥ 5 个（实际预期 F4.1 3 个 + F4.2 2 个 = 5 个，但分阶段独立做，每阶段 ≤ 3 个）

**deepseek v4-pro 的合理范围**：F4.1~F4.4 每个子阶段独立做、独立 commit，单阶段改动 ≤ 3 个文件，不涉及状态机或加密。

---

## 6. 验收 checklist

### F4.1 验收
- [ ] `shared/url_sniffer.py` 存在，含 3 层策略 + `SniffResult` dataclass
- [ ] `POST /workspaces/sniff-url` 端点可访问，返回正确 `primary_type`
- [ ] pytest `tests/backend/test_url_sniffer.py` ≥ 7 个 case 全部通过
- [ ] 嗅探失败（网络超时 / DNS 失败）不抛 500，返回 200 + `{"error": "..."}`

### F4.2 验收
- [x] 粘贴 URL 后 500ms debounce 自动调 sniffUrl
- [x] PreflightDrawer 的 `addWorkspaceItem` type 不再硬编码 `'video'`
- [x] sniff 失败时退化到 `type: 'video'`（旧行为不破坏）
- [x] 手动在 Composer 里输入 URL + 点"开始解析"→流程完整可走通
- [x] `./start.sh` + 浏览器验证：粘贴 B站视频 → 自动 video type → pipeline 正常
- [x] **收口修复 1**：PreflightDrawer 视频分析路径 UI 用 `resolvedType` 替代 `selectedTypes` 宽松判空，非视频 URL 不再显示视频路径
- [x] **收口修复 2**：Composer 嗅探 useEffect 在 `normalizedUrl` 变化时立即 `setSniffResult(null)`，旧 URL 嗅探结果不污染新 URL
- [x] **收口修复 3**：`resolvedType` 提为组件级变量，UI 可见性判断和 handleConfirm 共用同一来源

### F4.3 验收
- [x] sniff 返回 2 possible_types → PreflightDrawer 创建 2 个 item
- [x] 每个 item 的 preflight tasks 按各自 type 正确构建（video→summary 路径；audio/text/image→空 tasks 由后端 bridge 兜底）
- [x] 部分创建失败时 toast 显示成功数/失败数
- [x] sniff 返回 1 type 时行为与 F4.2 一致（不创建多余 item）
- [x] `typesToCreate` 逻辑：嗅探多类型 > selectedTypes > 单 resolvedType；platform type `article` → `text` 映射

### F4.4 验收
- [x] 后端 pytest 全通过（含新增 sniff case）
- [x] 前端 vitest 全通过
- [x] `pnpm build` 无类型错误
- [x] 手动冒烟 3 条 URL（视频 / 文章 / 图片）全部走通
- [x] 前端 vitest 新增 F4.3 多 item 创建 mock case

---

## 7. 执行顺序建议

```
F4.1（后端嗅探端点） → commit
  ↓
F4.2（前端接入）     → commit
  ↓
F4.4（写测试）       → commit（F4.1 + F4.2 的测试可以放这里统一补）
  ↓
F4.3（混合拆 item）  → commit
  ↓
F4.4（补 F4.3 测试） → commit（或与 F4.3 同一个 commit）
```

如果用户时间有限，**F4.1 + F4.2 是 MVP**——解决了"URL 不会自动识别类型"的核心痛点。F4.3 是锦上添花（B站视频+音频同下载的场景目前通过 MixedContentModal 已有雏形）。
