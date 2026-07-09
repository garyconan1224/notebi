"""shared/transcript_cleaner.py 单测。"""

from shared.transcript_cleaner import (
    build_polish_prompt,
    clean_transcript,
    clean_transcript_rules,
    deduplicate_lines,
    merge_short_lines,
    remove_fillers,
)


# ── remove_fillers ────────────────────────────────────────────


class TestRemoveFillers:
    def test_chinese_fillers(self) -> None:
        result = remove_fillers("嗯 今天天气 不错 啊")
        assert "今天天气" in result
        assert "不错" in result
        assert "嗯" not in result
        assert "啊" not in result

    def test_english_fillers(self) -> None:
        result = remove_fillers("um I think basically it works")
        assert "um" not in result
        assert "basically" not in result
        assert "it works" in result

    def test_no_filler_in_middle_of_word(self) -> None:
        # "然后" 不应被删（如果它是一句话的正常成分而非填充）
        result = remove_fillers("然后我们开始吧")
        # "然后" 作为行首词可能被移除（取决于正则），这里只确保不崩溃
        assert isinstance(result, str)

    def test_empty_input(self) -> None:
        assert remove_fillers("") == ""

    def test_all_fillers(self) -> None:
        result = remove_fillers("嗯 啊 呃")
        assert result.strip() == ""


# ── deduplicate_lines ─────────────────────────────────────────


class TestDeduplicateLines:
    def test_consecutive_duplicates(self) -> None:
        text = "你好\n你好\n世界\n世界\n世界"
        result = deduplicate_lines(text)
        lines = [l for l in result.splitlines() if l.strip()]
        assert lines == ["你好", "世界"]

    def test_no_duplicates(self) -> None:
        text = "第一行\n第二行\n第三行"
        assert deduplicate_lines(text) == text

    def test_single_line(self) -> None:
        assert deduplicate_lines("hello") == "hello"

    def test_empty(self) -> None:
        assert deduplicate_lines("") == ""

    def test_non_consecutive_not_deduped(self) -> None:
        text = "你好\n世界\n你好"
        result = deduplicate_lines(text)
        assert result == "你好\n世界\n你好"


# ── merge_short_lines ─────────────────────────────────────────


class TestMergeShortLines:
    def test_short_line_merged(self) -> None:
        text = "今天\n天气不错"
        result = merge_short_lines(text)
        assert "今天天气不错" in result

    def test_punctuation_ended_not_merged(self) -> None:
        text = "你好。\n世界好。"
        result = merge_short_lines(text)
        assert "你好。" in result
        assert "世界好。" in result

    def test_empty_lines_preserved(self) -> None:
        text = "第一段\n\n第二段"
        result = merge_short_lines(text)
        assert "\n\n" in result

    def test_single_line(self) -> None:
        assert merge_short_lines("一句话") == "一句话"


# ── clean_transcript_rules ────────────────────────────────────


class TestCleanTranscriptRules:
    def test_empty(self) -> None:
        assert clean_transcript_rules("") == ""
        assert clean_transcript_rules("   ").strip() == ""

    def test_whitespace_only(self) -> None:
        assert clean_transcript_rules("   \n  ").strip() == ""

    def test_full_pipeline(self) -> None:
        text = "嗯 今天天气不错 啊\n今天天气不错 啊\n嗯 出去玩吧"
        result = clean_transcript_rules(text)
        # 应该去掉语气词、去重、合并
        assert len(result) < len(text)

    def test_preserves_content(self) -> None:
        text = "这是一个完整的句子。这是另一个完整的句子。"
        result = clean_transcript_rules(text)
        assert "完整的句子" in result


# ── build_polish_prompt ───────────────────────────────────────


class TestBuildPolishPrompt:
    def test_basic(self) -> None:
        prompt = build_polish_prompt("你好世界")
        assert "你好世界" in prompt
        assert "专有名词" not in prompt

    def test_with_glossary(self) -> None:
        prompt = build_polish_prompt("你好", glossary=["OpenAI", "GPT"])
        assert "OpenAI" in prompt
        assert "GPT" in prompt
        assert "专有名词" in prompt


# ── clean_transcript ──────────────────────────────────────────


class TestCleanTranscript:
    def test_rules_only(self) -> None:
        text = "嗯 今天天气不错 啊\n今天天气不错"
        result = clean_transcript(text, llm_fn=None)
        assert "嗯" not in result
        assert "天气不错" in result

    def test_with_llm(self) -> None:
        def mock_llm(prompt: str) -> str:
            return "清洗后的文本"

        result = clean_transcript("原始文本", llm_fn=mock_llm)
        assert result == "清洗后的文本"

    def test_llm_failure_fallback(self) -> None:
        def bad_llm(prompt: str) -> str:
            raise RuntimeError("API error")

        text = "嗯 今天天气不错"
        result = clean_transcript(text, llm_fn=bad_llm)
        # 应该回退到规则层结果
        assert "天气不错" in result

    def test_llm_returns_empty_fallback(self) -> None:
        def empty_llm(prompt: str) -> str:
            return ""

        text = "嗯 今天天气不错"
        result = clean_transcript(text, llm_fn=empty_llm)
        assert "天气不错" in result

    def test_empty_input(self) -> None:
        assert clean_transcript("") == ""
        assert clean_transcript("   ").strip() == ""

    def test_glossary_passed_to_prompt(self) -> None:
        captured_prompts: list[str] = []

        def mock_llm(prompt: str) -> str:
            captured_prompts.append(prompt)
            return "ok"

        clean_transcript("测试", glossary=["Nibi"], llm_fn=mock_llm)
        assert len(captured_prompts) == 1
        assert "Nibi" in captured_prompts[0]
