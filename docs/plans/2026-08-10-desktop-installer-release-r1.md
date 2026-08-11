# NoteBi 桌面安装器与全平台发行 R1 计划

> 状态：执行中；Windows x64 未签名开发版与 Linux x64 优先，Apple 全部后置。用户已授权新增发行依赖与跨文件实现。

## 目标

先交付 Windows x64 未签名开发版和 Linux x64 可重复构建资产。应用安装完成且 `/health` 就绪后进入主页面；模型只在安装后的设置页由用户点击下载，并可单独选择存储目录。

## 当前证据

- GitHub：`garyconan1224/notebi`，Private，默认分支 `codex/release-github`；commit `38e812b` 的 Backend Tests、Frontend Build、Lint 均已在 GitHub Actions 成功。
- 本地前端：575 tests passed；`pnpm --dir frontend build` 已通过。
- 本地后端：1517 passed、2 skipped、6 deselected；Linux 可选 MLX 依赖测试已改为显式假模块并通过远端复验。
- 发行基础：Tauri 桌面壳、平台 sidecar、FFmpeg 校验、`/health` 后再打开主页面。
- 已新增 `src-tauri`、Rust/Cargo/Tauri/PyInstaller 与 Windows/Linux 预览工作流；当前缺口是远端原生构建结果和目标平台实机验收。
- 现有设置页模型下载器已经满足“明确点击才下载”；本批只补模型存储目录保存/回读，不抽成安装前下载器。
- OpenDesign 项目：`notebi-installer-experience-2026-08-10`；早期稿中的安装期模型步骤已作废，当前生产实现只复用其纸张色、墨色、蓝色强调与启动动效语言。

## 先确认的架构选择

### A. 原生安装 + 首次准备窗口（推荐）

- Windows：NSIS 选择应用目录；首次启动只等待应用资源与 `/health`，不下载模型。
- macOS：后置；未来由用户在 DMG/Finder 中决定 `.app` 放置位置，模型仍在应用设置页管理。
- Linux：AppImage 文件位置就是应用位置，`.deb` 走系统目录；模型在应用设置页管理。
- 优点：遵守各平台签名、升级和卸载习惯；Tauri 官方管线可直接使用。

### B. 自定义统一二级安装器

- 三个平台都先运行 bootstrapper，由它选择应用目录、下载模型，再下载/展开主应用。
- 代价：需要维护两套可执行程序、原子升级/回滚和额外签名链；macOS 已签名 app bundle 不能在安装后随意修改。
- 只有用户明确要求“三个平台都必须在 NoteBi 自己的页面选择应用目录”时采用。

用户可见结果：应用位置与模型位置分离；模型未下载不阻止打开，应用组件或 `/health` 未通过时不进入主页面。

Windows 开发版按 A 实施：NSIS 负责应用目录，NoteBi 启动页只负责应用资源与 `/health` 门禁。模型目录进入主页面后再到设置页保存。

## 批次

### R1.0：发行契约与设置页模型目录

1. 冻结应用资产 manifest：产品版本、平台/架构、文件大小与 SHA256。
2. 冻结安装状态：`preflight → installing → starting → ready/failed`，明确没有模型下载阶段。
3. 设置页保存并 GET 回读模型目录；只有用户点击具体模型的下载按钮才联网。

### R1.1：Windows x64 未签名开发版最小闭环

1. 经用户授权安装并锁定 Rust stable、Tauri 2 CLI/API、PyInstaller。
2. 新增 Tauri + NSIS 壳；NSIS 选择应用目录，启动页只在 sidecar 和 `/health` 就绪前阻断 main。
3. Python sidecar 使用 `onedir`，FFmpeg/FFprobe 6.1.1 作为带固定 SHA256 的平台资源；用户数据和模型均放在 app bundle 外。`onefile` 本机验证因首次解压约 1.2 GB、接近两分钟才启动而否决。
4. GitHub Windows runner 生成 `windows-x64-unsigned-preview`，不得写 Signed；本机不可替代 Windows 安装证据。
5. Windows 实测安装目录、设置页模型目录/点击下载、端口冲突、`/health` 超时、卸载和残留数据策略。

### R1.2：Windows / Linux CI 构建

1. GitHub Actions 原生矩阵：Windows x64、Ubuntu x64；Apple job 后置。
2. 每个 job 锁定 Node/Python/Rust，运行前后端测试，构建 sidecar 与桌面资产，生成 SHA256 和 SBOM。
3. 第一轮只上传短期 Actions Artifact；任何目标失败都不创建 GitHub Release。
4. 安装器 smoke test 至少覆盖启动门禁和 `/health`，实机媒体能力另做平台验收。

### R1.3：Apple 签名与正式发行

1. 接入 `docs/RELEASE_ACCOUNTS.md` 中的 Apple 所有者凭据；不配置 Windows 签名。
2. 开启 GitHub `release` environment 人工批准；签名 secret 不进入 PR job。
3. macOS 先签名/公证再上传；Windows 继续作为未签名开发资产并显示 SmartScreen/签名限制；生成 provenance、SHA256、许可证与已知限制。
4. Windows/Linux 真实安装、卸载、设置页模型下载、真实素材导入→转写→笔记→导出→重启读回完成后才转正式版。

## 新依赖授权

用户已明确要求除 Apple 外继续所有可做项，授权：

- 安装 Rust stable toolchain；
- 在前端锁文件中加入 Tauri 2 CLI/API；
- 新增并锁定发行专用 Python 依赖（首选独立 release requirements，不污染运行依赖）；
- 允许新增 `src-tauri/`、`packaging/` 和发行 workflow，预计明显超过 5 个文件。

## 验收红线

- 不能用“构建成功”代替安装、启动和真实素材验证。
- 不能在 macOS 机器伪称 Windows/Linux 实机验收。
- 未签名资产必须明确写 Preview；未公证不能写 Notarized。
- 应用资源或 `/health` 任一未通过时，主窗口路由不可达；模型未下载不是启动失败。
- 不复制 `.env`、`.local/settings.json`、用户数据库、API key、模型平台 token 或测试素材进安装包。
