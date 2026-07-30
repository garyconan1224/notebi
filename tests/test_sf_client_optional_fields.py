from __future__ import annotations

import json

from shared import sf_client


def test_chat_completion_retries_without_rejected_temperature(monkeypatch) -> None:
    calls: list[dict] = []

    def fake_post(_key, _path, payload, **_kwargs):
        calls.append(dict(payload))
        if "temperature" in payload:
            raise sf_client.SiliconFlowError("HTTP 400: unsupported parameter: temperature")
        return {"choices": [{"message": {"content": "可见回答"}}]}

    monkeypatch.setattr(sf_client, "_post_json", fake_post)

    result = sf_client.chat_completion("key", "strict-model", [{"role": "user", "content": "hi"}])

    assert result == "可见回答"
    assert calls[0]["temperature"] == 0.7
    assert "temperature" not in calls[1]


def test_stream_retries_without_rejected_thinking_parameter(monkeypatch) -> None:
    calls: list[dict] = []

    class FakeResponse:
        def __init__(self, status_code: int, body: dict | None = None) -> None:
            self.status_code = status_code
            self._body = body or {}
            self.text = json.dumps(self._body)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def json(self):
            return self._body

        def iter_lines(self):
            return iter([
                'data: {"choices":[{"delta":{"content":"可见"}}]}'.encode("utf-8"),
                'data: {"choices":[{"delta":{"content":"回答"}}]}'.encode("utf-8"),
                b"data: [DONE]",
            ])

    def fake_requests_post(_url, **kwargs):
        calls.append(dict(kwargs["json"]))
        if "enable_thinking" in kwargs["json"]:
            return FakeResponse(400, {"error": {"message": "unsupported parameter enable_thinking"}})
        return FakeResponse(200)

    monkeypatch.setattr(sf_client.requests, "post", fake_requests_post)

    chunks = list(
        sf_client.chat_completion_stream(
            "key",
            "strict-model",
            [{"role": "user", "content": "hi"}],
            enable_thinking=True,
        )
    )

    assert "".join(chunks) == "可见回答"
    assert calls[0]["enable_thinking"] is True
    assert "enable_thinking" not in calls[1]
