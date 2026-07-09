"""R18: 总结模板系统测试。"""

from backend.app.services.summary_templates import TEMPLATES, get_template, list_template_ids


def test_all_template_ids_loadable():
    """16 个模板 id 都能加载（R3.1 新增 standard，VN2 新增 science_popularization）。"""
    expected_ids = [
        "concise", "detailed", "quotes", "meeting",
        "xhs", "longform", "lecture", "interview", "shownotes",
        "oral", "steps", "outline", "qa", "actions", "tool_recommendation",
        "science_popularization", "standard",
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
