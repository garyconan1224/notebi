# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## 依赖管理说明

### 包管理器

本项目前端固定使用 **npm**（见 `package-lock.json`）。请勿混用 `yarn` 或 `pnpm` 安装依赖，否则 lockfile 与 `overrides` 配置将失效。

### `overrides` 决策记录

**背景**：`@lobehub/icons` 及其传递依赖（`antd-style`、`react-layout-kit` 等）声明 `react` peerDependency 为 `^19.0.0`。若未来上游依赖出现锁定到 React 18 的分支，或升级 `@lobehub/icons` 至新主版本后 peerDep 范围发生漂移，`npm install` 将产生 `ERESOLVE` 告警或安装失败。

**当前方案**：`package.json` 的 `overrides` 块将 `@lobehub/icons` 子树中的 `react` / `react-dom` 强制指向顶层声明版本（通过 `$react` / `$react-dom` 语法复用版本号，避免漂移）。

**为什么选 `overrides` 而非迁移到 `pnpm`**：

| 维度 | 当前方案（overrides） | 替代方案（pnpm 迁移） |
|---|---|---|
| 迁移成本 | 零：仅 6 行配置 | 高：需改 CI、启动脚本、贡献者文档、Docker 镜像 |
| 构建流稳定性 | 不变，`npm ci` 行为完全一致 | 需验证所有产物体积与路径别名一致 |
| 团队协作 | 无额外学习成本 | 贡献者需启用 `corepack` 并理解 pnpm 严格依赖图 |
| 风险 | 静默屏蔽真实 peer 不兼容，需在 CR 中重审 | 暴露幽灵依赖，安装阶段失败可定位但需逐个修复 |

结论：在本项目规模下（前端仅为单体子目录，无 monorepo 收益），`overrides` 的成本收益比显著优于 pnpm 迁移；长期若引入更多带 peerDep 冲突的品牌图标库或桌面端依赖，再评估 pnpm。

### 维护规则（强制）

1. **每次 `@lobehub/icons` 升级主版本**（如 `5.x` → `6.x`）时，必须重新评估 `overrides` 块是否仍为必要：
   - 若新版本 peerDep 已天然兼容顶层 React 版本 → 删除 `overrides` 条目，并删除本段说明。
   - 若仍不兼容 → 记录升级时间与评估结论在 Git commit message 中（JSON 原生不支持注释）。
   - 执行 `npm ls @lobehub/icons react` 验证子树版本一致性。
2. 任何新增的 `overrides` 条目必须同时更新本章节，并附注原因、日期、复查条件。
3. CI 中建议加入 `npm ls @lobehub/icons react` 断言，防止子树出现意外 React 版本分叉。

### 决策历史

| 日期 | 版本 | 决策 | 依据 |
|---|---|---|---|
| 2024-04-22 | @lobehub/icons 5.5.4 + react 19.2.5 | 启用 overrides 统一 react/react-dom | peerDep ^19.0.0，npm 默认不强制，但考虑到未来可能的版本变动，主动配置以增强稳定性 |

### 相关文件

- `package.json` → `overrides` 字段
- `package-lock.json` → 最终依赖解析结果


Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
