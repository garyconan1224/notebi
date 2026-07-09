/**
 * markmap 封装模块
 *
 * 封装 markmap-lib Transformer（Markdown → AST）
 * 与 markmap-view Markmap（AST → SVG 渲染）
 *
 * 使用动态 import 避免 markmap-lib (~200KB) 阻塞首屏加载
 */

import type { ITransformResult } from 'markmap-lib'
import type { Markmap as MarkmapClass } from 'markmap-view'

/** 将 Markdown 字符串转换为 Markmap 所需的 AST 数据 */
export async function transformMarkdown(markdown: string): Promise<ITransformResult> {
  // 动态 import：markmap-lib 体积较大，避免首屏阻塞
  const { Transformer } = await import('markmap-lib')
  const transformer = new Transformer()
  return transformer.transform(markdown)
}

/** 在目标 SVG 元素上初始化 Markmap 实例 */
export async function createMarkmap(
  svgEl: SVGSVGElement,
  transformResult: ITransformResult,
): Promise<MarkmapClass> {
  const { Markmap } = await import('markmap-view')
  const mm = Markmap.create(svgEl, {
    autoFit: true,
    duration: 300,
    zoom: true,
    pan: true,
  })
  await mm.setData(transformResult.root)
  await mm.fit()
  return mm
}

