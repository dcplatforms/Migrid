const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const files = [
    'docs/index.html',
    'docs/architecture.html',
    'docs/roadmap.html',
    'migridDocs.html',
    'migrid-docs-roadmap.html'
  ];

  for (const file of files) {
    const filePath = 'file://' + path.resolve(file);
    console.log('Verifying ' + file);
    await page.goto(filePath);
    await page.screenshot({ path: 'screenshot_final_' + file.replace(/\//g, '_') + '.png', fullPage: true });
  }

  await browser.close();
})();
