from backend.app.services import transcript_service


def test_transcript_prefers_subtitle(monkeypatch) -> None:
    monkeypatch.setattr(
        transcript_service,
        "fetch_best_subtitle",
        lambda url: ("subtitle text", [], {"lang": "zh"}),
    )
    out = transcript_service.get_transcript("https://example.com/v")
    assert out["source"] == "subtitle"
    assert "subtitle text" in out["text"]


def test_transcript_falls_back_to_asr(monkeypatch) -> None:
    monkeypatch.setattr(transcript_service, "fetch_best_subtitle", lambda url: None)
    monkeypatch.setattr(transcript_service, "_download_audio_bytes", lambda url: b"fake")
    monkeypatch.setattr(
        transcript_service,
        "transcribe_with_fast_whisper",
        lambda audio_bytes, model_name="base", device="cpu": "asr text",
    )
    out = transcript_service.get_transcript("https://example.com/v", enable_groq=False)
    assert out["source"] == "asr_fast_whisper"
    assert "asr text" in out["text"]
