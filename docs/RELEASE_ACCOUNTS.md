# NoteBi 发行账号与密钥清单

> 目的：把“Codex 现在可以完成的工作”和“必须由项目所有者实名、付费或接受协议的工作”分开。任何证书、密码、token 或私钥都不得写入仓库。

## 现在不需要新增账号

- GitHub 私有仓库、Issues、Actions、源码检查和 Draft Release：使用现有 `garyconan1224/notebi` 即可。
- macOS / Windows / Linux 的未签名安装包构建、SHA256、SBOM、安装 smoke test 和预发行资产：可先在 CI 完成，但必须标记为 unsigned preview。
- Windows x64 按用户决定只做未签名开发版；不申请、不接入 Windows 代码签名账号，资产与说明必须持续标注 `unsigned-preview` 和 SmartScreen 风险。
- Tauri updater 密钥对：可以本地生成；公钥进应用配置，私钥只进 GitHub Actions Secrets，不需要第三方账号。
- Linux AppImage / `.deb` 的 GitHub Release 分发：不要求商店账号。

## 后续必须由所有者处理

| 平台 / 能力 | 需要什么 | 为什么不能由 Codex 代办 | 后续给 CI 的内容 |
|---|---|---|---|
| macOS 正式签名与公证 | Apple Developer Program 会员、身份验证、付费和协议；Developer ID Application 证书（账号审核中） | 账号和证书归属个人或企业，涉及法律协议与付款 | 证书、证书密码、Team ID，以及公证使用的 App Store Connect API key 或 Apple ID 专用密码 |
| 受限模型 | 模型平台账号、访问申请和模型许可证同意 | 接受许可证必须由实际使用/分发主体完成 | 只在构建环境短时使用下载凭据；Release 不附带无再分发授权的权重 |
| 商店分发（可选） | Microsoft Store、Mac App Store、Flathub、Snap Store 等各自账号和协议 | 不是 GitHub 安装包首发的必需条件，且审核/协议由所有者承担 | 等 GitHub Release 稳定后再按渠道单独配置 |

## 首发建议

1. 先用现有 GitHub 账号发布私有 Draft / Prerelease，完成四目标构建与实机安装证据。
2. Windows 开发版始终明确写 `windows-x64-unsigned-preview`，说明可能出现 SmartScreen；不等待也不配置 Windows 签名。
3. Apple 账号就绪后，把证书和公证配置写入 GitHub Actions Secrets / Environments，并为 `release` 环境开启人工批准。
4. 四平台安装、卸载、两个目录、模型恢复、SHA256、`/health` 和真实素材闭环都通过后，再把 Prerelease 提升为正式 Release。

## 仓库公开前的额外停点

- 完整历史 313 个 commit 中有 306 个使用 `.local` 本机邮箱，范围从仓库首个 `33c5cf3` 到 `384f85e`。仓库仍为 Private；转 Public 前需由用户明确授权重写完整历史邮箱，或确认接受这些地址公开。只 amend 单个 commit 不能解决问题。
- 2026-08-10 已完成一次无新增工具的保守扫描：当前树没有被跟踪的 `.env`/证书/私钥文件，历史没有单个超过 50 MiB 的 blob；疑似 `sk-`、私钥和 API key 命中均已定位为 CSS 名称、占位示例或敏感内容过滤测试。正式公开前仍需用专门的历史扫描器再跑一次，不能把本次启发式检查当成最终密钥审计。
- 公开前重新执行历史密钥扫描、超大文件扫描、许可证清单和模型再分发审计。
- 默认分支、分支保护、Issue/PR 模板和 CI 必须都指向最终公开分支，不能继续依赖临时发布分支名称。

## 官方依据

- [Apple Developer Program 加入要求](https://developer.apple.com/programs/enroll/)
- [Apple Developer ID 证书](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Tauri macOS 签名](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows 签名](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri Updater](https://v2.tauri.app/plugin/updater/)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [提交 WinGet manifest](https://learn.microsoft.com/en-us/windows/package-manager/package/repository)
- [Homebrew 软件提交流程](https://docs.brew.sh/Adding-Software-to-Homebrew)
