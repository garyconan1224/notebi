"""
B站无Cookie下载器 - 突破技术核心

基于B站公开API + WBI签名，实现：
1. 游客模式获取视频信息（/x/web-interface/view）
2. WBI签名计算（img_key + sub_key）
3. playurl API调用（/x/player/wbi/playurl）
4. 字幕API免登录获取（/x/player/v2）
5. 360P/480P直链下载（游客开放档位）

无Cookie策略：
- 优先级：字幕 > 低清直链 > yt-dlp兜底
- 风控对抗：随机UA + 指数退避 + Referer
"""

import hashlib
import json
import logging
import re
import time
import urllib.parse
from typing import Dict, List, Optional, Any
from pathlib import Path

import requests
from tenacity import retry, wait_exponential, stop_after_attempt

try:
    from .base import Downloader, AudioDownloadResult, TranscriptResult, TranscriptSegment, VideoMeta, DownloadQuality
except ImportError:
    # 测试时的绝对导入
    from base import Downloader, AudioDownloadResult, TranscriptResult, TranscriptSegment, VideoMeta, DownloadQuality

logger = logging.getLogger(__name__)

# B站API endpoints
BILIBILI_API_BASE = "https://api.bilibili.com"
VIEW_API = f"{BILIBILI_API_BASE}/x/web-interface/view"
NAV_API = f"{BILIBILI_API_BASE}/x/web-interface/nav"
PLAYURL_API = f"{BILIBILI_API_BASE}/x/player/wbi/playurl"
SUBTITLE_API = f"{BILIBILI_API_BASE}/x/player/v2"

# 桌面User-Agent池（随机选择，降低风控）
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15"
]

# WBI signing key获取表（img_url -> sub_key映射）
mixinKeyEncTab = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
]


def extract_bvid_from_url(url: str) -> Optional[str]:
    """从B站URL提取BVID"""
    patterns = [
        r'bilibili\.com/video/([Bb][Vv][A-Za-z0-9]+)',
        r'bilibili\.com/video/([Bb][Vv][A-Za-z0-9]+)/',
        r'b23\.tv/([A-Za-z0-9]+)',  # 短链
        r'[Bb][Vv]([A-Za-z0-9]+)'  # 直接BVID
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            bvid = match.group(1)
            if not bvid.upper().startswith('BV'):
                bvid = f'BV{bvid}'
            return bvid.upper()
    return None


def get_mixin_key(orig: str) -> str:
    """根据img_key和sub_key生成mixin_key"""
    return ''.join([orig[i] for i in mixinKeyEncTab])[:32]


def enc_wbi(params: Dict[str, Any], img_key: str, sub_key: str) -> Dict[str, Any]:
    """WBI签名计算"""
    mixin_key = get_mixin_key(img_key + sub_key)
    curr_time = round(time.time())
    params['wts'] = curr_time

    # 参数排序并构建query string
    query = urllib.parse.urlencode(sorted(params.items()))

    # 计算签名
    wbi_sign = hashlib.md5((query + mixin_key).encode()).hexdigest()
    params['w_rid'] = wbi_sign

    return params


class BilibiliNoCookieDownloader(Downloader):
    """B站无Cookie下载器"""

    def __init__(self, cache_data: str = "./data/cache"):
        super().__init__()
        self.session = requests.Session()
        self.wbi_img_key = None
        self.wbi_sub_key = None
        self.last_wbi_update = 0

        # 设置默认headers
        self.session.headers.update({
            'Referer': 'https://www.bilibili.com/',
            'Origin': 'https://www.bilibili.com',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site'
        })

    def _update_user_agent(self):
        """随机更新UA（降低风控）"""
        import random
        self.session.headers['User-Agent'] = random.choice(USER_AGENTS)

    @retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(3))
    def _get_wbi_keys(self) -> tuple[str, str]:
        """获取WBI签名密钥"""
        if (self.wbi_img_key and self.wbi_sub_key and
            time.time() - self.last_wbi_update < 600):  # 10分钟内复用
            return self.wbi_img_key, self.wbi_sub_key

        self._update_user_agent()
        resp = self.session.get(NAV_API, timeout=10)
        resp.raise_for_status()

        data = resp.json()
        if data.get('code') != 0:
            raise Exception(f"获取WBI密钥失败: {data.get('message')}")

        wbi_img = data['data']['wbi_img']['img_url']
        wbi_sub = data['data']['wbi_img']['sub_url']

        self.wbi_img_key = wbi_img.split('/')[-1].split('.')[0]
        self.wbi_sub_key = wbi_sub.split('/')[-1].split('.')[0]
        self.last_wbi_update = time.time()

        logger.info(f"WBI密钥更新: img_key={self.wbi_img_key[:8]}..., sub_key={self.wbi_sub_key[:8]}...")
        return self.wbi_img_key, self.wbi_sub_key

    def supports_subtitles(self) -> bool:
        return True

    def supports_no_cookie(self) -> bool:
        return True

    @retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(3))
    def get_meta(self, video_url: str) -> VideoMeta:
        """获取视频元信息"""
        bvid = extract_bvid_from_url(video_url)
        if not bvid:
            raise ValueError(f"无法从URL提取BVID: {video_url}")

        self._update_user_agent()
        params = {'bvid': bvid}

        resp = self.session.get(VIEW_API, params=params, timeout=15)
        resp.raise_for_status()

        data = resp.json()
        if data.get('code') != 0:
            raise Exception(f"获取视频信息失败: {data.get('message')}")

        video_info = data['data']

        # 解析标签
        tags = []
        if 'tag' in video_info:
            tags = [tag['tag_name'] for tag in video_info.get('tag', [])]

        return VideoMeta(
            video_id=bvid,
            title=video_info.get('title', ''),
            description=video_info.get('desc', ''),
            duration=video_info.get('duration', 0),
            cover_url=video_info.get('pic', ''),
            author=video_info.get('owner', {}).get('name', ''),
            platform="bilibili",
            view_count=video_info.get('stat', {}).get('view', 0),
            upload_date=time.strftime('%Y-%m-%d', time.localtime(video_info.get('pubdate', 0))),
            tags=tags,
            raw_info=video_info
        )

    @retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(3))
    def download_subtitles(
        self,
        video_url: str,
        output_dir: Optional[str] = None,
        langs: Optional[List[str]] = None
    ) -> Optional[TranscriptResult]:
        """获取B站字幕（无需Cookie）"""
        if langs is None:
            langs = ['zh-CN', 'zh-Hans', 'zh', 'ai-zh', 'en']

        bvid = extract_bvid_from_url(video_url)
        if not bvid:
            raise ValueError(f"无法从URL提取BVID: {video_url}")

        # 首先获取视频基本信息（aid + cid）
        video_meta = self.get_meta(video_url)
        aid = video_meta.raw_info.get('aid')
        cid = video_meta.raw_info.get('cid')

        if not aid or not cid:
            logger.warning(f"无法获取aid/cid: aid={aid}, cid={cid}")
            return None

        # 调用字幕API
        self._update_user_agent()
        params = {
            'aid': aid,
            'cid': cid
        }

        resp = self.session.get(SUBTITLE_API, params=params, timeout=15)
        resp.raise_for_status()

        data = resp.json()
        if data.get('code') != 0:
            logger.warning(f"字幕API调用失败: {data.get('message')}")
            return None

        subtitle_data = data.get('data', {}).get('subtitle', {})
        subtitles = subtitle_data.get('subtitles', [])

        if not subtitles:
            logger.info(f"视频 {bvid} 无可用字幕")
            return None

        # 按语言优先级选择字幕
        selected_subtitle = None
        for lang in langs:
            for sub in subtitles:
                if sub.get('lan') == lang or sub.get('lan_doc') == lang:
                    selected_subtitle = sub
                    break
            if selected_subtitle:
                break

        # 如果没匹配到优先语言，选择第一个
        if not selected_subtitle:
            selected_subtitle = subtitles[0]

        # 下载字幕内容
        subtitle_url = selected_subtitle.get('subtitle_url')
        if not subtitle_url:
            logger.warning("字幕URL为空")
            return None

        # B站字幕URL可能是相对路径，补齐为绝对路径
        if subtitle_url.startswith('//'):
            subtitle_url = 'https:' + subtitle_url
        elif subtitle_url.startswith('/'):
            subtitle_url = 'https://api.bilibili.com' + subtitle_url

        sub_resp = self.session.get(subtitle_url, timeout=10)
        sub_resp.raise_for_status()

        sub_data = sub_resp.json()

        # 解析字幕段落
        segments = []
        full_text_parts = []

        for item in sub_data.get('body', []):
            start_time = float(item.get('from', 0))
            end_time = float(item.get('to', 0))
            text = item.get('content', '').strip()

            if text:
                segments.append(TranscriptSegment(
                    start=start_time,
                    end=end_time,
                    text=text
                ))
                full_text_parts.append(text)

        if not segments:
            logger.warning("字幕内容为空")
            return None

        logger.info(f"成功获取字幕: {len(segments)} 个片段, 语言: {selected_subtitle.get('lan')}")

        return TranscriptResult(
            language=selected_subtitle.get('lan'),
            full_text='\n'.join(full_text_parts),
            segments=segments
        )

    @retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(3))
    def _get_playurl(self, aid: int, cid: int, quality: DownloadQuality = DownloadQuality.medium):
        """获取视频播放链接（无Cookie方案）"""

        # 质量映射（游客可访问的档位）
        qn_map = {
            DownloadQuality.fast: 16,    # 360P
            DownloadQuality.medium: 32,  # 480P
            DownloadQuality.high: 64     # 720P（可能需要登录）
        }

        qn = qn_map.get(quality, 32)

        params = {
            'avid': aid,
            'cid': cid,
            'qn': qn,
            'platform': 'html5',
            'high_quality': 0
        }

        self._update_user_agent()
        resp = self.session.get("https://api.bilibili.com/x/player/playurl",
                               params=params, timeout=15)
        resp.raise_for_status()

        data = resp.json()
        if data.get('code') != 0:
            raise Exception(f"playurl API调用失败: {data.get('message')}")

        play_data = data.get('data', {})
        if not play_data.get('durl'):
            raise Exception("playurl响应中无durl字段")

        return play_data['durl']

    def download(
        self,
        video_url: str,
        output_dir: Optional[str] = None,
        quality: DownloadQuality = DownloadQuality.medium,
        need_video: bool = False
    ) -> AudioDownloadResult:
        """下载音频（优先字幕，无字幕才下载音频）"""

        if output_dir is None:
            output_dir = str(self.cache_data)

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        # 1. 先尝试获取字幕（避免下载音频）
        transcript = self.download_subtitles(video_url)
        if transcript:
            logger.info("找到字幕，跳过音频下载")
            # 创建虚拟音频文件路径（实际不下载）
            meta = self.get_meta(video_url)
            return AudioDownloadResult(
                file_path="",  # 无音频文件
                title=meta.title,
                duration=meta.duration,
                cover_url=meta.cover_url,
                platform="bilibili",
                video_id=meta.video_id,
                raw_info=meta.raw_info
            )

        # 2. 无字幕时才下载音频
        logger.info("无字幕，开始下载音频...")
        meta = self.get_meta(video_url)
        aid = meta.raw_info.get('aid')
        cid = meta.raw_info.get('cid')

        if not aid or not cid:
            raise ValueError(f"无法获取AID/CID: aid={aid}, cid={cid}")

        # 获取播放链接
        durl_list = self._get_playurl(aid, cid, quality)

        # 下载第一个片段作为音频
        first_durl = durl_list[0]
        video_url_direct = first_durl['url']

        # 设置文件名
        safe_title = re.sub(r'[^\w\-_\.]', '_', meta.title)[:50]
        audio_filename = f"{safe_title}_{meta.video_id}.mp4"
        audio_path = output_path / audio_filename

        # 下载视频文件
        self._download_file(video_url_direct, str(audio_path))

        video_path = None
        if need_video:
            video_path = str(audio_path)  # 复用同一文件

        return AudioDownloadResult(
            file_path=str(audio_path),
            title=meta.title,
            duration=meta.duration,
            cover_url=meta.cover_url,
            platform="bilibili",
            video_id=meta.video_id,
            raw_info=meta.raw_info,
            video_path=video_path
        )

    def download_video(
        self,
        video_url: str,
        output_dir: Optional[str] = None,
    ) -> str:
        """下载视频文件"""
        result = self.download(video_url, output_dir, DownloadQuality.medium, need_video=True)
        if result.video_path:
            return result.video_path
        elif result.file_path:
            return result.file_path
        else:
            raise Exception("视频下载失败，无文件路径")

    def _download_file(self, url: str, file_path: str):
        """下载文件到本地"""
        self._update_user_agent()

        # 添加Referer，避免403
        headers = self.session.headers.copy()
        headers['Referer'] = 'https://www.bilibili.com/'

        with self.session.get(url, headers=headers, stream=True, timeout=30) as resp:
            resp.raise_for_status()

            with open(file_path, 'wb') as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)

        logger.info(f"文件下载完成: {file_path}")