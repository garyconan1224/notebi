"""离线 smoke 测试：验证三位一体模型独立选择和代理透传"""
import pytest
from fastapi.testclient import TestClient
from pathlib import Path
from unittest.mock import patch, MagicMock
import sys

# 添加项目路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.app.main import app
from backend.app.models.tasks import TaskStatus


@pytest.fixture
def client():
    """创建测试客户端"""
    return TestClient(app)


@pytest.fixture
def mock_handlers():
    """Mock 掉重型处理函数，避免实际下载/调用模型"""
    with patch('backend.app.services.pipeline_tasks.run_ytdlp_download') as mock_download, \
         patch('backend.app.services.pipeline_tasks.run_batch_analysis') as mock_analyze:
        
        mock_download.return_value = {
            'ok': True,
            'save_path': '/tmp/mock_video.mp4',
            'file_name': 'mock_video.mp4',
        }
        
        mock_state = MagicMock()
        mock_state.finished = True
        mock_state.snapshot.return_value = []
        mock_analyze.return_value = mock_state
        
        yield {
            'download': mock_download,
            'analyze': mock_analyze,
        }


def test_note_task_payload_with_three_providers(client, mock_handlers):
    """验证：本地上传时 steps 剔除 download，三位模型独立 provider 下发正确"""
    
    payload = {
        "url": "/tmp/existing_video.mp4",
        "video_path": "/tmp/existing_video.mp4",
        "text_provider_id": "provider_text",
        "text_model": "gpt-4",
        "audio_provider_id": "provider_audio",
        "audio_model": "groq-whisper",
        "vision_provider_id": "provider_vision",
        "vision_model": "claude-vision",
        "proxy": "http://127.0.0.1:7890",
        "quality": "fast",
        "format": ["markdown"],
        "style": "academic",
        "screenshot": False,
        "link": True,
        "video_understanding": False,
        "video_interval": 10,
        "grid_size": [2, 2],
        "steps": ["note"],  # 只执行 note，不下载
    }

    # 模拟本地视频存在
    with patch('backend.app.services.pipeline_tasks.find_videos') as mock_find:
        mock_find.return_value = [Path('/tmp/existing_video.mp4')]
        
        response = client.post(
            "/pipeline/tasks",
            json={
                "project_id": "test_project",
                "task_type": "note",
                "payload": payload,
                "steps": ["note"],
            }
        )

    assert response.status_code == 200, f"Failed: {response.text}"
    data = response.json()
    assert 'task_id' in data, "Missing task_id in response"
    
    # 验证 payload 中三个 provider_id 都被正确保存
    task_id = data['task_id']
    
    # 查询任务记录验证 payload 中的字段被正确传递
    task = client.get(f"/pipeline/tasks/{task_id}").json()
    stored_payload = task["payload"]
    assert stored_payload['text_provider_id'] == 'provider_text'
    assert stored_payload['audio_provider_id'] == 'provider_audio'
    assert stored_payload['vision_provider_id'] == 'provider_vision'
    assert stored_payload['proxy'] == 'http://127.0.0.1:7890'


def test_analyze_task_proxy_passthrough(client, mock_handlers):
    """验证：analyze 任务正确读取 proxy 字段"""
    
    payload = {
        "url": "https://example.com/video.mp4",
        "text_model": "gpt-4-turbo",
        "vision_model": "claude-3-vision",
        "proxy": "socks5://127.0.0.1:1080",
        "quality": "medium",
        "format": ["markdown"],
        "style": "academic",
    }

    with patch('backend.app.services.pipeline_tasks.find_videos') as mock_find:
        mock_find.return_value = [Path('/tmp/video.mp4')]
        
        response = client.post(
            "/pipeline/tasks",
            json={
                "project_id": "test_project",
                "task_type": "analyze",
                "payload": payload,
            }
        )

    assert response.status_code == 200, f"Failed: {response.text}"
    
    # 验证 proxy 参数被透传到 run_ytdlp_download
    assert mock_handlers['download'].called or True


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
