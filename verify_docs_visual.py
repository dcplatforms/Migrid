
import asyncio
from playwright.async_api import async_playwright
import os

async def capture():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1280, 'height': 3000})

        files = {
            'migrid-docs-roadmap.html': 'roadmap_main.png',
            'docs/roadmap.html': 'roadmap_docs.png',
            'docs/architecture.html': 'architecture.png',
            'migridDocs.html': 'infographic.png'
        }

        for html_file, img_file in files.items():
            if os.path.exists(html_file):
                await page.goto(f'file://{os.path.abspath(html_file)}')
                # Wait for any animations
                await asyncio.sleep(1)
                await page.screenshot(path=img_file, full_page=True)
                print(f"Captured {html_file} to {img_file}")
            else:
                print(f"File not found: {html_file}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(capture())
