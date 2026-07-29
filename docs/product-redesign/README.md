# NoteBi 产品重构设计基线

状态：Open Design 第二轮校准通过  
日期：2026-07-29

## 设计事实源

- Open Design 项目：`页面设计优化审查`
- Project ID：`2bd11d3f-ecc1-4d2c-89b5-d7e95b41c8d1`
- 校准 Run ID：`9bc9caef-1e5c-4f10-b474-ba21c0fc31cb`
- 原型预览：<http://127.0.0.1:54579/api/projects/2bd11d3f-ecc1-4d2c-89b5-d7e95b41c8d1/raw/index.html>
- 原型源文件：Open Design 项目中的 `index.html`

## 仓库内产物

- `DESIGN.md`：视觉、信息架构、数据边界和响应式合同。
- `IMPLEMENTATION_SPEC.md`：路由、页面、交互、模型和验收规格。
- `IMPLEMENTATION_MAP.md`：每阶段落地时持续更新的设计到代码映射。

Open Design 原型使用仓库真实短 token 词汇，但它是交互设计样机，不是第二套生产 CSS。生产实现的 token 唯一事实源仍是
`frontend/src/styles/nibi-tokens.css`。
