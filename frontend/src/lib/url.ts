const BILIBILI_BV_RE = /^BV[a-zA-Z0-9]+$/;

/** 抖音短链模式——用于从分享文案中提取纯 URL */
const DOUYIN_URL_RE = /https?:\/\/(?:v\.douyin\.com|www\.douyin\.com|www\.iesdouyin\.com|dy\.com)\/[^\s]+/i;

/** 通用 URL 提取——从任意分享文案中提取第一个 https?:// 开头的 URL（去除尾部中文标点） */
const GENERIC_URL_RE = /https?:\/\/[^\s，。！？；：""''（）【】《》]+/;

/** 追踪参数白名单——这些参数不影响视频唯一性，应移除 */
const TRACKING_PARAMS = new Set([
  "spm_id_from",
  "vd_source",
  "share_source",
  "share_medium",
  "bbid",
  "ts",
  "unique_k",
  "p",
  "vd_source_2",
]);

export function normalizeMediaUrl(raw: string): string {
  let s = raw.trim();

  // ① 从分享文案中提取纯 URL
  // 优先匹配抖音短链，否则通用提取第一个 https?:// 开头的 URL
  // 例："8.92 复制打开抖音，看看【...】... https://v.douyin.com/xxx/ ..."
  const dyMatch = s.match(DOUYIN_URL_RE);
  if (dyMatch) {
    s = dyMatch[0];
  } else {
    // 小红书/快手/任意分享文案：提取第一个 URL
    // 例："【标题】... http://xhslink.com/xxx 复制本条笔记..."
    const genericMatch = s.match(GENERIC_URL_RE);
    if (genericMatch) {
      s = genericMatch[0];
    }
  }

  // ② 纯 BV 号 → 拼完整 B站 URL
  if (BILIBILI_BV_RE.test(s)) {
    s = `https://www.bilibili.com/video/${s}`;
  }

  // ③ 缺 scheme（没有任何 :// 的才补 https://）
  if (!s.includes("://")) {
    s = `https://${s}`;
  }

  // ④ 解析 URL，清掉追踪参数 + 去掉尾斜杠
  try {
    const u = new URL(s);
    const removals: string[] = [];
    for (const k of u.searchParams.keys()) {
      if (TRACKING_PARAMS.has(k)) removals.push(k);
    }
    for (const k of removals) u.searchParams.delete(k);
    // 保留 query（如有非追踪参数），去掉 fragment + 尾斜杠
    const clean = u.origin + u.pathname.replace(/\/+$/, "") + u.search;
    return clean;
  } catch {
    // URL 解析失败（极少见），返回补了 scheme 的版本
    return s.replace(/\/+$/, "");
  }
}
