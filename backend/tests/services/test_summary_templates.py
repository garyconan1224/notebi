"""R18: 总结模板系统测试。"""

from types import SimpleNamespace

from backend.app.services.summary_templates import TEMPLATES, get_template, list_template_ids


def test_all_template_ids_loadable():
    """16 个模板 id 都能加载（R3.1 新增 standard，VN2 新增 science_popularization）。"""
    expected_ids = [
        "concise", "detailed", "quotes", "meeting",
        "xhs", "longform", "lecture", "interview", "shownotes",
        "oral", "steps", "outline", "qa", "actions", "tool_recommendation",
        "science_popularization", "standard",
        "speaker_meeting", "speaker_interview", "speaker_customer_reception",
    ]
    assert list_template_ids() == expected_ids
    for tid in expected_ids:
        tpl = get_template(tid)
        assert tpl.id == tid
        assert tpl.label
        assert tpl.system_prompt
        assert tpl.user_prompt


def test_unknown_id_fallback_concise():
    """未知 id 回退到 concise。"""
    tpl = get_template("nonexistent_template")
    assert tpl.id == "concise"
    assert tpl.label == "精简摘要"


def test_template_user_prompt_has_transcript_placeholder():
    """每个模板的 user_prompt 都包含 {transcript} 占位符。"""
    for tid in list_template_ids():
        tpl = get_template(tid)
        assert "{transcript}" in tpl.user_prompt, f"{tid} 缺少 {{transcript}} 占位符"


def test_vn6_contract_templates_have_full_structure():
    """VN6：教程/会议纪要/任务导向模板升级为完整输出 contract（锁定关键小节）。"""
    expectations = {
        "steps": ["学完能做到什么", "前置条件", "操作步骤", "常见坑", "验收"],
        "meeting": ["议题概览", "关键讨论与结论", "待办事项", "风险", "参会人"],
        "actions": ["目标", "行动项", "依赖", "完成标准"],
    }
    for tid, sections in expectations.items():
        sp = get_template(tid).system_prompt
        for sec in sections:
            assert sec in sp, f"{tid} contract 缺少小节「{sec}」"


def test_speaker_aware_business_templates_have_evidence_contracts():
    expectations = {
        "speaker_meeting": ["逐人立场", "决议", "负责人", "截止时间", "风险", "时间证据"],
        "speaker_interview": ["Q&A", "受访者", "主题", "原话证据", "分歧", "未回答"],
        "speaker_customer_reception": ["客户现状", "目标", "痛点", "需求优先级", "异议", "决策链", "双方承诺"],
    }
    for template_id, required_terms in expectations.items():
        template = get_template(template_id)
        assert template.speaker_aware_only is True
        assert "style_audio" in template.style_categories
        assert "style_video_with_frames" in template.style_categories
        assert "style_video_text_only" in template.style_categories
        for term in required_terms:
            assert term in template.system_prompt, f"{template_id} 缺少「{term}」"
        assert "不得编造" in template.system_prompt
        assert "时间" in template.system_prompt


def test_speaker_template_override_preserves_scope(monkeypatch):
    """编辑内置区分说话人模板后，不能丢失仅音频、仅区分说话人的约束。"""
    from shared import template_store

    override = SimpleNamespace(
        template_id="speaker_meeting",
        category="style_audio",
        name="我的会议纪要",
        prompt="请按我的结构整理：\n\n{transcript}",
    )
    monkeypatch.setattr(template_store, "load_templates", lambda: [override])

    template = get_template("speaker_meeting")

    assert template.label == "我的会议纪要"
    assert "style_audio" in template.style_categories
    assert "style_video_with_frames" in template.style_categories
    assert "style_video_text_only" in template.style_categories
    assert template.speaker_aware_only is True
    assert "说话人与证据规则" in template.system_prompt
