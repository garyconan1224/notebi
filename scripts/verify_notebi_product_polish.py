"""Browser smoke checks for the NoteBi product-polish changes.

Run against an already-running local frontend:
    .venv/bin/python scripts/verify_notebi_product_polish.py
"""

from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = "http://localhost:5181"
SCREENSHOT_DIR = Path("/tmp/notebi-product-polish")


def wait_for_page(page) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(250)


def main() -> None:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})

        page.goto(BASE_URL)
        wait_for_page(page)
        home_text = page.locator("body").inner_text()
        assert "Nibi" not in home_text
        assert "NoteBi" in home_text
        page.screenshot(path=str(SCREENSHOT_DIR / "home.png"), full_page=True)

        page.get_by_role("button", name="新建").click()
        page.get_by_role("dialog", name="添加素材").wait_for()
        page.get_by_role("button", name="视频笔记 视频转写 + 时间戳 + 截帧").click()
        dialog = page.get_by_role("dialog", name="添加素材")
        assert dialog.get_by_text("区分说话人", exact=True).is_visible()
        assert dialog.get_by_text("AI视频", exact=True).count() == 0
        assert dialog.get_by_text("分镜脚本", exact=True).count() == 0
        assert dialog.get_by_text("二创改写", exact=True).count() == 0
        dialog.get_by_role("switch", name="区分说话人 开启后在转写中标注不同说话人，并使用区分说话人的专属总结方式").click()
        style_picker = dialog.get_by_role("combobox", name="区分说话人的总结方式")
        assert style_picker.is_visible()
        assert "咨询师录音版本详细总结" in style_picker.inner_text()
        style_picker.click()
        assert page.get_by_role("option", name="咨询师录音版本详细总结").is_visible()
        assert page.get_by_role("option", name="咨询师录音版会议纪要/客户声音").is_visible()
        page.screenshot(path=str(SCREENSHOT_DIR / "add-material-speaker-aware.png"), full_page=True)

        page.goto(f"{BASE_URL}/settings/providers-models")
        wait_for_page(page)
        settings_text = page.locator("body").inner_text()
        assert "Nibi" not in settings_text
        visual_label = page.get_by_text("视觉模型", exact=True)
        visual_row = visual_label.locator("xpath=../..")
        visual_row.get_by_role("button", name="设置").click()
        provider_select = visual_row.get_by_role("combobox")
        provider_select.wait_for()
        provider_options = provider_select.locator("option").all_text_contents()
        assert any("SiliconFlow" in option for option in provider_options), provider_options
        page.screenshot(path=str(SCREENSHOT_DIR / "visual-model-provider-options.png"), full_page=True)

        print("browser product-polish checks passed")
        browser.close()


if __name__ == "__main__":
    main()
