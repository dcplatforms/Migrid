import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        files = [
            'docs/index.html',
            'docs/architecture.html',
            'docs/roadmap.html',
            'migridDocs.html',
            'migrid-docs-roadmap.html'
        ]

        for file in files:
            file_path = 'file://' + os.path.abspath(file)
            print(f'Verifying {file}')
            await page.goto(file_path)
            screenshot_path = 'screenshot_final_' + file.replace('/', '_') + '.png'
            await page.screenshot(path=screenshot_path, full_page=True)

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
