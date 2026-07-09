---
phase: RP1-A 主题修复 + 页面整合（P1 + P3）· mimo 启动提示词
status: done
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-A
user_source: 2026-05-30 用户报告"颜色经常自己变 / 切换按钮找不到 / 每个模式都不应该看不清 / Overview 和 audio_detail 内容重复"
diagnosed_by: Opus 4.7（next-themes 用 class 选择器，design-tokens.css 用 [data-theme="dark"] 选择器，永远不互通；ThemeSwitcher 组件未挂载）
---

## 0. 背景（mimo 必读）

项目有两套主题机制**永远不互通**导致颜色 bug：

| 系统 | dark 触发方式 |
|---|---|
| **next-themes**（shadcn 用）| `<html class="dark">` |
| **design-tokens.css** | `[data-theme="dark"]` |

切 dark mode 时，只有一边生效 → 一半组件深色 + 一半浅色 → 撞色"字看不清"。
而且 ThemeSwitcher 组件**写好了但未挂载到任何页面**（grep 整 frontend/src 找不到 import）→ 用户找不到切换按钮。

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端，选 Sonnet 角色）

```
RP1-A 主题修复（P1）+ 页面整合（P3）：修主题分裂 bug + 挂 ThemeSwitcher + 删两页内容重复。
详细方案见 docs/plans/rp1-theme-fix-mimo-prompt.md（必读 §2 + §3）。

【P1 主题修复】

任务 1: 让 next-themes 同时设 class + data-theme，统一两套主题系统
  - 文件: frontend/src/main.tsx
  - 当前: <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  - 改成: <ThemeProvider attribute={['class', 'data-theme']} defaultTheme="system" enableSystem>
  - 验证: 打开任意页面 → DevTools 看 <html> 同时有 class="light" 和 data-theme="light"
  - 副效果: design-tokens.css 的 [data-theme="dark"] 块在 dark mode 终于会生效

任务 2: 挂 ThemeSwitcher 到 AppShell 顶栏（右上角状态条旁边）
  - 文件: frontend/src/layouts/AppShell.tsx
  - 位置: 找"CPU / MEM"状态条那一段（line ~180），在状态条**前**插入 <ThemeSwitcher />
  - import: import ThemeSwitcher from '@/components/ThemeSwitcher'
  - 验证: 刷新页面右上角看到 太阳/月亮/电脑 图标按钮，hover 显示"浅色主题/深色主题/系统主题"，点击循环切换

任务 3: 检查 design-tokens.css dark mode token 完整性
  - 文件: frontend/src/styles/design-tokens.css
  - [data-theme="dark"] 块当前只覆盖 --bg/--bg-elev/--bg-sunken/--ink/--ink-2/3/4/--line/--line-strong/--pill-bg/--pill-ink/--shadow-sm/md/lg
  - 漏覆盖的设计稿色（dark 时需要重新定义，否则保持 light 值在深色背景上看不清）:
    * --accent-pink / --accent-purple / --accent-blue / --accent-warm / --accent-green
    * （这 5 个 accent 色在 light 下用 #FF4D7E/#B84CFF/#3C77FB/#FFB84C/#22D39A）
    * dark 模式建议:
        --accent-pink:  #FF6B95;   // 提亮 +10% 保对比度
        --accent-purple:#C66DFF;
        --accent-blue:  #5A8FFF;
        --accent-warm:  #FFC76F;
        --accent-green: #3FE0AD;
  - 验证: dark mode 下进入音频页 → 字幕"高亮粉色" / "复制" 按钮颜色清晰可读

任务 4: 对比度自测（dark + light 两个模式）
  - 切到 dark 模式 + 跑 playwright 截图 audio_detail + overview，检查没有"白底白字 / 黑底黑字"
  - 切到 light 模式 + 同上
  - 截图归档: docs/e2e-test/screenshots/p1-theme-{dark,light}-{audio_detail,overview}.png × 4 张

【P3 页面整合（轻量）】

任务 5: 删 AudioResultPage 顶部 ItemTagsPanel（避免与 Overview 重复）
  - 文件: frontend/src/pages/result/AudioResultPage.tsx
  - 找 line ~395 附近的 <div style="padding: 10px 20px 0"> <ItemTagsPanel .../> </div>
  - 整段删除
  - 同时删 import ItemTagsPanel（如果只在那一处用）
  - 验证: audio_detail 页打开 → 顶部直接是播放器，没有"内容标签"卡片

任务 6: AudioResultPage 顶栏"返回任务中心"改为"← 返回总览"
  - 文件: frontend/src/pages/result/AudioResultPage.tsx
  - 找 line ~308 "任务中心" 按钮
  - 文本改"返回总览"
  - onClick 从 navigate(-1) 改为 navigate(`/workspaces/${workspaceId}/items/${itemId}/overview`)
  - 验证: 点击"返回总览"跳到 overview 路由

任务 7: Overview 每个素材卡片右下角加"打开详情 →"按钮
  - 文件: frontend/src/pages/result/ResultsOverview/index.tsx
  - 各 .ov-card / .ov-action-card 找合适位置加按钮
  - onClick 按 itemType 跳: navigate(`/workspaces/${workspaceId}/items/${itemId}/${itemType}_detail`)
    （audio_detail / video_detail / image_detail / text_detail 四种）
  - 验证: overview 打开 → 每个素材区有清晰的"打开详情"按钮 → 点击跳详情页

【范围限制（不要做的）】
- 不要改 LearningNotesPage / 视频复刻页
- 不要重写 ThemeSwitcher 组件（仅挂载，不动逻辑）
- 不要新装依赖
- 不要留 debug 脚本

【验证】
- pnpm build EXIT=0
- npx tsc --noEmit EXIT=0
- 4 张主题对比截图归档
- git commit 一个: feat(rp1-a): 主题分裂修复 + 挂 ThemeSwitcher + 删两页内容重复
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK.md 末尾追加一段
- 不要 push

预估工作量: 3-4h
```

## 2. mimo 实施 cheat sheet（不在提示词里，但 mimo 实际改代码时参考）

### 2.1 任务 1 改动详情

```diff
-  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
+  <ThemeProvider attribute={['class', 'data-theme']} defaultTheme="system" enableSystem>
```

next-themes v0.2+ 支持 attribute 数组，会同时设 `<html class="dark" data-theme="dark">`。

### 2.2 任务 2 AppShell 插入位置参考

[frontend/src/layouts/AppShell.tsx](frontend/src/layouts/AppShell.tsx) 找：
```tsx
<div>
  <div ... 后端 {BACKEND_ADDR} ...></div>
  <div>CPU ...</div>
</div>
```

ThemeSwitcher 加在这个外层 div 内、状态指示条**之前**或之后都行（设计稿无明确规定，靠 mimo 视觉判断哪边更平衡）。

### 2.3 任务 3 设计稿 dark accent 取值

参考"提亮 10%"原则，保 4.5 对比度即可。如果 mimo 不放心可去掉这个任务（保留 light 值）—— dark 模式下背景 #0d0c10，原 #FF4D7E 粉色对比度 7.2 其实足够（只是看起来稍闷），可以观望。

## 3. 风险预案

| 风险 | 概率 | 应对 |
|---|---|---|
| next-themes 不支持 attribute 数组（旧版本）| 低 | 看 package.json next-themes 版本，<0.2.0 需升级；或拆成两个 effect 手动 setAttribute |
| AppShell 顶栏空间不够 | 低 | 试 sm size + 移除 tooltip |
| 删 ItemTagsPanel 后某测试期待它存在 | 低 | tsc/test 报错就改测试 |
| 主题切换后某些 inline style 仍写死 #fff（不跟随主题）| 中 | 这次只解决 token 系统，单点 inline 颜色 bug 后续二次迭代 |

## 4. 验收标准（mimo 报告时检查）

- [ ] DevTools 看 html 标签同时有 class 和 data-theme
- [ ] AppShell 右上角看见 ThemeSwitcher 按钮
- [ ] 点击切换 light → dark → system → light 循环
- [ ] dark mode 下 audio_detail 顶部 + 字幕 + 总结 tab 都能清晰看见文字
- [ ] light mode 下同上
- [ ] audio_detail 顶部不再有"内容标签"卡片
- [ ] audio_detail 顶栏"返回总览"点击跳 overview
- [ ] overview 每个卡片有"打开详情 →"按钮
- [ ] 4 张归档截图清晰可见
- [ ] pnpm build + tsc EXIT=0
- [ ] 1 个 commit 颗粒度清晰
- [ ] COMPLETED_WORK.md 追加段
- [ ] **没有留 debug 脚本**（之前留过 4 个 debug_*.py，这次绝不能再留）
