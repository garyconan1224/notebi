"""M6 平台扩展验证：逐平台测试 yt-dlp 下载能力。"""
import sys
import os
import tempfile
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from shared.video_download_ytdlp import run_ytdlp_download, is_platform_url

# 测试链接：每个平台一个短视频（公开、无登录要求）
TEST_URLS = {
    "YouTube": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",  # 经典短片
    "抖音": "https://v.douyin.com/iMJqS9Nn/",  # 短视频分享链接
    "快手": "https://www.kuaishou.com/short-video/3x4e5g92eq7geh6",  # 快手短视频
    "小红书-视频": "https://www.xiaohongshu.com/explore/6650a1c2000000001c00b8a1",  # 小红书视频笔记
}


def test_platform(name: str, url: str) -> dict:
    """测试单个平台的下载能力。"""
    print(f"\n{'='*60}")
    print(f"🔍 测试平台: {name}")
    print(f"📎 URL: {url}")
    print(f"🔗 is_platform_url: {is_platform_url(url)}")
    print(f"{'='*60}")

    with tempfile.TemporaryDirectory() as tmpdir:
        logs = []
        def log_fn(msg):
            logs.append(msg)
            print(f"  {msg}")

        try:
            result = run_ytdlp_download(
                url=url,
                output_dir=tmpdir,
                log=log_fn,
            )

            if result.get("ok"):
                save_path = result.get("save_path", "")
                file_size = os.path.getsize(save_path) if save_path and os.path.exists(save_path) else 0
                print(f"  ✅ 下载成功!")
                print(f"     文件: {result.get('file_name', 'N/A')}")
                print(f"     大小: {file_size / 1024:.1f} KB")
                print(f"     路径: {save_path}")
                return {"platform": name, "status": "✅ 通", "file_size": file_size, "error": None}
            else:
                error = result.get("error", "未知错误")
                print(f"  ❌ 下载失败: {error}")
                return {"platform": name, "status": "❌ 失败", "file_size": 0, "error": error}

        except Exception as e:
            print(f"  💥 异常: {e}")
            return {"platform": name, "status": "💥 异常", "file_size": 0, "error": str(e)}


def main():
    print("=" * 60)
    print("M6 平台扩展验证 — 逐平台测试 yt-dlp 下载")
    print("=" * 60)

    results = []
    for name, url in TEST_URLS.items():
        result = test_platform(name, url)
        results.append(result)

    print("\n" + "=" * 60)
    print("📊 汇总结果")
    print("=" * 60)
    for r in results:
        error_info = f" | 错误: {r['error']}" if r['error'] else ""
        print(f"  {r['platform']:12s} {r['status']}{error_info}")

    # 输出 JSON 供后续分析
    print("\n📋 JSON:")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
