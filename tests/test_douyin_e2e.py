"""抖音全链路 E2E 测试：下载→转写→笔记。

通过后端 API 走完整 pipeline，验证抖音分享链接能否端到端跑通。
"""
import json
import sys
import time
import requests

BASE = "http://localhost:8000"
TEST_URL = "https://v.douyin.com/eRFo6_OJBmY/"


def main():
    print("=" * 60)
    print("抖音全链路 E2E 测试")
    print("=" * 60)

    # 1. 创建工作空间
    print("\n[1/5] 创建工作空间…")
    r = requests.post(f"{BASE}/workspaces", json={
        "name": "抖音E2E测试",
        "type": "video",
    })
    r.raise_for_status()
    ws = r.json()
    ws_id = ws["workspace_id"]
    print(f"  ✓ workspace_id: {ws_id}")

    # 2. 添加素材（抖音链接）
    print("\n[2/5] 添加抖音链接…")
    r = requests.post(f"{BASE}/workspaces/{ws_id}/items", json={
        "type": "video",
        "source": "url",
        "source_value": TEST_URL,
        "name": "抖音测试视频",
    })
    r.raise_for_status()
    item_data = r.json()
    # 找到刚添加的 item
    items = item_data.get("items", [])
    item_id = items[-1]["item_id"] if items else None
    if not item_id:
        print("  ❌ 未找到添加的 item")
        sys.exit(1)
    print(f"  ✓ item_id: {item_id}")

    # 3. 设置 preflight（选择要跑的任务）
    print("\n[3/5] 配置分析任务（转写+总结）…")
    r = requests.put(f"{BASE}/workspaces/{ws_id}/items/{item_id}/preflight", json={
        "intent": "study",
        "tasks": {
            "subtitle": {"on": True},
            "summary": {"on": True},
        },
    })
    r.raise_for_status()
    print("  ✓ preflight 已保存")

    # 4. 启动 pipeline
    print("\n[4/5] 启动处理流水线…")
    r = requests.post(f"{BASE}/workspaces/{ws_id}/items/{item_id}/start")
    r.raise_for_status()
    start_data = r.json()
    task_id = start_data["task_id"]
    task_type = start_data["task_type"]
    print(f"  ✓ task_id: {task_id}")
    print(f"  ✓ task_type: {task_type}")

    # 5. 监听任务进度（SSE）
    print("\n[5/5] 等待处理完成…")
    final_status = None
    last_pct = -1
    start_time = time.time()

    try:
        r = requests.get(
            f"{BASE}/pipeline/tasks/{task_id}/events",
            stream=True,
            timeout=600,
        )
        for line in r.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data: "):
                continue
            data = json.loads(line[6:])
            status = data.get("status", "")
            pct = data.get("progress", 0) * 100
            log_msgs = data.get("log_messages", [])

            # 打印新日志
            for msg in log_msgs:
                print(f"  {msg}")

            # 打印进度
            if pct > last_pct + 5:
                elapsed = time.time() - start_time
                print(f"  [{elapsed:.0f}s] 进度: {pct:.0f}%")
                last_pct = pct

            if status in ("done", "error", "cancelled"):
                final_status = status
                break
    except requests.exceptions.ReadTimeout:
        print("  ⚠️ SSE 连接超时（600s），尝试检查任务状态…")
    except Exception as e:
        print(f"  ⚠️ SSE 异常: {e}")

    elapsed = time.time() - start_time

    # 6. 检查结果
    print("\n" + "=" * 60)
    print("📊 结果")
    print("=" * 60)

    # 获取任务详情
    r = requests.get(f"{BASE}/pipeline/tasks/{task_id}")
    r.raise_for_status()
    task = r.json()

    print(f"  状态: {task.get('status', 'unknown')}")
    print(f"  耗时: {elapsed:.0f}s")
    print(f"  task_type: {task.get('task_type', 'unknown')}")

    result = task.get("result", {})
    if result:
        print(f"  下载文件: {result.get('file_name', 'N/A')}")
        print(f"  视频标题: {result.get('video_title', 'N/A')}")

    # 获取 item 的结果
    r = requests.get(f"{BASE}/workspaces/{ws_id}/items/{item_id}/result")
    if r.status_code == 200:
        item_result = r.json()
        summary = item_result.get("summary", "")
        transcript = item_result.get("transcript", "")
        print(f"\n  📝 摘要长度: {len(summary)} 字符")
        if summary:
            print(f"  📝 摘要前200字:\n    {summary[:200]}...")
        print(f"  📝 转写长度: {len(transcript)} 字符")
        if transcript:
            print(f"  📝 转写前200字:\n    {transcript[:200]}...")
    else:
        print(f"  ⚠️ 获取结果失败: {r.status_code}")

    # 获取 workspace 详情看 items 状态
    r = requests.get(f"{BASE}/workspaces/{ws_id}")
    if r.status_code == 200:
        ws_detail = r.json()
        for it in ws_detail.get("items", []):
            if it["item_id"] == item_id:
                print(f"\n  item 状态: {it.get('status', 'unknown')}")
                break

    print("\n" + "=" * 60)
    if final_status == "done":
        print("✅ 抖音全链路测试通过！")
    elif final_status == "error":
        print("❌ 抖音全链路测试失败！")
        if result.get("error"):
            print(f"  错误: {result['error']}")
    else:
        print(f"⚠️ 最终状态: {final_status}")

    return 0 if final_status == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
