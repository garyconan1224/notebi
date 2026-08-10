# NoteBi 全平台发行路线

> 状态：推荐方案，等待维护者确认后再实施。桌面壳与安装包尚未实现，本文不代表任何平台安装包已经通过实机验收。

## 结论

NoteBi 当前是 React 前端加本地 FastAPI 服务，不是原生桌面应用。要提供面向普通用户的 macOS、Windows 和 Linux 安装包，推荐保留现有业务架构，新增一个轻量桌面壳：

```text
Tauri 2 桌面壳
├── frontend/dist
├── NoteBi FastAPI sidecar（各平台原生构建）
├── FFmpeg / FFprobe（各平台独立资产）
├── 用户数据目录
└── 模型下载、许可证与完整性清单
```

桌面壳只负责窗口、启动/停止后端、端口与健康检查、日志位置和升级。笔记、转写、总结、知识库和导出仍由现有 FastAPI 与 React 代码提供，避免重写业务。

## 为什么采用 Tauri 2 + Python sidecar

- Tauri 可直接使用现有 Vite 构建产物，不需要重写 React 页面。
- Tauri 的 `externalBin` 支持把 Python API 服务作为 sidecar，并要求按目标架构提供对应二进制。
- 后端先使用 PyInstaller `onedir` 或等价的目录式 runtime；重量级模型和动态库不适合一开始压成单文件。
- PyInstaller 不是交叉编译器：Windows 包在 Windows 构建，macOS 包在 macOS 构建，Linux 包在 Linux 构建。
- 模型权重不默认塞进安装器。首次使用按能力下载，并显示来源、许可证、版本、大小与 SHA256；内网离线包继续走现有独立构建流程。

## 目标发行资产

| 目标 | GitHub Release 资产 | 最低验收 |
|---|---|---|
| macOS Apple Silicon | `NoteBi_<version>_aarch64.dmg` | 签名、公证、启动、ASR、说话人、导出 |
| macOS Intel | `NoteBi_<version>_x64.dmg` | 签名、公证、CPU ASR、远程模型、导出 |
| Windows x64 | `NoteBi_<version>_x64-setup.exe` 或 `.msi` | 签名、安装/卸载、FFmpeg、ASR、说话人、导出 |
| Linux x64 | `NoteBi_<version>_amd64.AppImage` 与 `.deb` | Ubuntu 实机启动、ASR、远程模型、导出 |

Linux ARM64 和 Windows ARM64 放在第二阶段；先把四个主要资产做成可重复构建和可真实验收的版本。

## 原生构建矩阵

GitHub Actions 使用各平台原生 runner：

- `macos-latest`：Apple Silicon；另用 Intel runner 构建 x64。
- `windows-latest`：Windows x64。
- `ubuntu-22.04`：Linux x64。

每个 job 依次完成：锁定 Python / Node / Rust 版本、安装发行依赖、运行前后端测试、构建前端、构建 Python sidecar、生成安装包、启动 smoke test、上传草稿 Release。不得在一个平台伪造另一个平台的构建或验收结果。

## 签名与密钥

- macOS 浏览器下载的应用需要 Developer ID 签名和 Apple 公证，正式发布需要 Apple Developer 账号。
- Windows 未签名安装包通常会触发 SmartScreen；正式公开前应准备代码签名证书或受支持的云签名服务。
- 证书、密码和 API 凭据只进入 GitHub Actions Secrets，不写入仓库、日志、构建缓存或 Release Asset。
- 没有正式证书时只发布清楚标记的预览版，不把 ad-hoc 签名描述成已公证发行版。

## 分批实施

### R0：GitHub 源码上线

1. 私有仓库首次推送并运行现有后端、前端和编译检查。
2. 检查 README、Issue 模板、许可证、历史密钥扫描和仓库大小。
3. 维护者确认后切换为 Public；此阶段不创建虚假的桌面 Release。

### R1：桌面壳最小闭环

1. 维护者确认架构并授权新增 Rust / Tauri / PyInstaller 依赖。
2. 新增 Tauri 2 壳和单一开发平台 sidecar。
3. 完成启动、退出、后端异常、端口冲突、日志与用户数据目录。
4. 用真实素材完成一次导入、转写、生成笔记、编辑、导出和重启读回。

### R2：四目标原生打包

1. 在各平台原生 runner 构建 sidecar 与安装包。
2. 把 FFmpeg 和原生 Python 依赖按平台锁定。
3. 为每个平台执行安装后 `/health`、前端打开和最小 API smoke test。

### R3：签名、模型与正式 Release

1. 配置 macOS 签名/公证和 Windows 签名。
2. 建立模型许可证、版本、SHA256 与首次下载流程。
3. 先创建 Draft/Prerelease，完成四平台实机验收后再提升为正式 Release。

## 本轮不做

- 不安装 Rust、Tauri、PyInstaller 或新的系统依赖。
- 不提交尚不能构建的空工作流。
- 不上传模型权重、Python runtime、FFmpeg 或未签名安装包。
- 不宣称 Windows/Linux 已通过实机验收。

## 官方依据

- [Tauri GitHub Actions 发布流程](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri 外部二进制与 sidecar](https://v2.tauri.app/develop/sidecar/)
- [Tauri macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows 代码签名](https://v2.tauri.app/distribute/sign/windows/)
- [PyInstaller 平台构建边界](https://github.com/pyinstaller/pyinstaller#readme)
- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
