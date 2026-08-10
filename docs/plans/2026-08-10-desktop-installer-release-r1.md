# NoteBi 桌面安装器与全平台发行 R1 计划

> 状态：执行中；Windows x64 未签名开发版优先，Apple 账号审核中。新增依赖、跨 5 个以上生产文件和安装器架构选择仍是强制停点。

## 目标

先交付 Windows x64 未签名开发版，再交付 macOS Apple Silicon / Intel 和 Linux x64 可重复构建资产。用户可以区分应用位置和模型位置；安装引导先准备并校验所选模型，所有组件和 `/health` 就绪后才进入 NoteBi 主页面。

## 当前证据

- GitHub：`garyconan1224/notebi`，Private，默认分支 `codex/release-github`；commit `38e812b` 的 Backend Tests、Frontend Build、Lint 均已在 GitHub Actions 成功。
- 本地前端：572 tests passed；`pnpm --dir frontend build` 已通过。
- 本地后端：1513 passed、2 skipped、6 deselected；Linux 可选 MLX 依赖测试已改为显式假模块并通过远端复验。
- 现有发行基础：Windows 离线 bundle 构建器、模型 `manifest.json` + SHA256 预检、`/health` 后再打开浏览器。
- 现有缺口：没有 `src-tauri`、Rust/Cargo/Tauri/PyInstaller，也没有 macOS/Windows/Linux 桌面产物。
- 现有模型下载器在 FastAPI 进程内运行，并明确不在启动时下载；安装器不能直接把它当作启动前下载器，需要抽出独立 manifest/下载层。
- OpenDesign 项目：`notebi-installer-experience-2026-08-10`，已覆盖两个目录、模型/许可证、断点续传、错误恢复、SHA256、`/health` 和完成门禁。

## 先确认的架构选择

### A. 原生安装 + 首次准备窗口（推荐）

- Windows：NSIS/MSI 选择应用目录；首次启动只显示 NoteBi 准备窗口，另选模型目录，模型与 `/health` 完成后才进入主页面。
- macOS：用户在 DMG/Finder 中决定 `.app` 放置位置；首次启动准备窗口另选模型目录，未完成不进入主页面。
- Linux：AppImage 文件位置就是应用位置，`.deb` 走系统目录；首次启动准备窗口另选模型目录。
- 优点：遵守各平台签名、升级和卸载习惯；Tauri 官方管线可直接使用。

### B. 自定义统一二级安装器

- 三个平台都先运行 bootstrapper，由它选择应用目录、下载模型，再下载/展开主应用。
- 代价：需要维护两套可执行程序、原子升级/回滚和额外签名链；macOS 已签名 app bundle 不能在安装后随意修改。
- 只有用户明确要求“三个平台都必须在 NoteBi 自己的页面选择应用目录”时采用。

无论选 A 或 B，用户可见结果不变：应用位置与模型位置分离；模型/组件未完成或 `/health` 未通过时不打开主页面。

Windows 开发版默认按 A 实施：NSIS 负责应用目录，NoteBi 首次准备窗口负责模型目录和启动门禁。若用户坚持应用目录也必须由 NoteBi 自己的统一页面处理，再改选 B。

## 批次

### R1.0：发行契约与模型 manifest

1. 冻结跨平台 manifest：产品版本、平台/架构、文件大小、SHA256、来源、许可证、必需/可选、镜像 URL。
2. 冻结安装状态：`preflight → paths → license → downloading/importing → verifying → installing → starting → ready/failed`。
3. 用标准库实现 manifest 校验和路径穿越防护；先写失败测试，再扩展现有 Windows 预检。
4. 待用户确认首装模型：建议按平台推荐一个 ASR 模型为必需，WeSpeaker/OCR/增强模型保持可选；不得在许可证未审计前写入真实下载 URL。

### R1.1：Windows x64 未签名开发版最小闭环

1. 经用户授权安装并锁定 Rust stable、Tauri 2 CLI/API、PyInstaller。
2. 新增 Tauri + NSIS 壳；NSIS 选择应用目录，setup/main 两个路由隔离，setup 完成记录和 manifest 校验共同决定能否进入 main。
3. Python sidecar 使用 `onedir`，FFmpeg 作为平台资源；用户数据和模型均放在 app bundle 外。
4. GitHub Windows runner 生成 `windows-x64-unsigned-preview`，不得写 Signed；本机不可替代 Windows 安装证据。
5. Windows 实测安装目录、模型目录、下载中断恢复、SHA256 失败、端口冲突、`/health` 超时、卸载和残留数据策略。

### R1.2：四目标 CI 构建

1. GitHub Actions 原生矩阵：macOS arm64、macOS x64、Windows x64、Ubuntu x64。
2. 每个 job 锁定 Node/Python/Rust，运行前后端测试，构建 sidecar 与桌面资产，生成 SHA256 和 SBOM。
3. 只上传 Draft/Prerelease；任何目标失败都不提升正式 Release。
4. 安装器 smoke test 至少覆盖启动门禁和 `/health`，实机媒体能力另做平台验收。

### R1.3：Apple 签名与正式发行

1. 接入 `docs/RELEASE_ACCOUNTS.md` 中的 Apple 所有者凭据；不配置 Windows 签名。
2. 开启 GitHub `release` environment 人工批准；签名 secret 不进入 PR job。
3. macOS 先签名/公证再上传；Windows 继续作为未签名开发资产并显示 SmartScreen/签名限制；生成 provenance、SHA256、许可证与已知限制。
4. 四平台真实安装、卸载、模型恢复、真实素材导入→转写→笔记→导出→重启读回完成后才转正式版。

## 新依赖停点

本机当前缺少：Rust、Cargo、Tauri、PyInstaller、Linux/Windows 打包器。进入 R1.1 前必须一次性确认：

- 安装 Rust stable toolchain；
- 在前端锁文件中加入 Tauri 2 CLI/API；
- 新增并锁定发行专用 Python 依赖（首选独立 release requirements，不污染运行依赖）；
- 允许新增 `src-tauri/`、`packaging/` 和发行 workflow，预计明显超过 5 个文件。

## 验收红线

- 不能用“构建成功”代替安装、启动和真实素材验证。
- 不能在 macOS 机器伪称 Windows/Linux 实机验收。
- 未签名资产必须明确写 Preview；未公证不能写 Notarized。
- 模型分片、应用资源或 `/health` 任一未通过时，主窗口路由不可达且“打开 NoteBi”不可用。
- 不复制 `.env`、`.local/settings.json`、用户数据库、API key、模型平台 token 或测试素材进安装包。
