#!/usr/bin/env python3
"""Capture UI screenshots using Playwright"""
import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright

async def capture_dashboard(url: str, output_dir: Path):
    """Capture Dashboard page screenshot"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080})

        print(f"📱 Navigating to {url}...")
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(8)  # Wait for Streamlit to fully render

        # Capture full page
        print("📸 Capturing full Dashboard...")
        await page.screenshot(path=output_dir / "dashboard_full.png", full_page=True)

        # Capture metric cards
        print("📸 Capturing metric cards...")
        await page.screenshot(path=output_dir / "dashboard_metrics.png", full_page=False)

        await browser.close()
        print("✅ Dashboard screenshots captured")

async def capture_templates(url: str, output_dir: Path):
    """Capture Templates page screenshot"""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080})

        print(f"📱 Navigating to {url}...")
        await page.goto(url, wait_until="networkidle", timeout=30000)
        await asyncio.sleep(2)

        # Click Templates in sidebar
        print("🖱️ Clicking Templates menu...")
        try:
            await page.click('text=Templates', timeout=5000)
            await asyncio.sleep(2)
        except:
            print("⚠️ Could not find Templates menu, trying alternative...")
            await page.evaluate("document.querySelector('[data-testid=\"stSidebar\"] button:nth-child(2)')?.click()")
            await asyncio.sleep(2)

        # Capture Templates page
        print("📸 Capturing Templates page...")
        await page.screenshot(path=output_dir / "templates_full.png", full_page=True)

        await browser.close()
        print("✅ Templates screenshots captured")

async def main():
    base_url = "http://127.0.0.1:8501"
    output_dir = Path(__file__).parent.parent / "screenshots"
    output_dir.mkdir(exist_ok=True)

    print("🚀 Starting UI capture...")
    print(f"📂 Output directory: {output_dir}")

    try:
        await capture_dashboard(base_url, output_dir)
        await capture_templates(base_url, output_dir)

        print("\n✅ All screenshots captured successfully!")
        print(f"📂 Screenshots saved to: {output_dir}")
        for img in sorted(output_dir.glob("*.png")):
            print(f"   - {img.name}")

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
