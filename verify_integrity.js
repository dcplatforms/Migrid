const fs = require('fs');
const path = require('path');

const files = [
  'docs/index.html',
  'docs/architecture.html',
  'docs/roadmap.html',
  'migridDocs.html',
  'migrid-docs-roadmap.html'
];

let errors = 0;

files.forEach(file => {
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: File not found: ${file}`);
    errors++;
  } else {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('undefined') || content.includes('NaN')) {
      console.warn(`WARNING: Potential rendering error in ${file} (contains 'undefined' or 'NaN')`);
    }

    // Check for broken internal links (very basic)
    const links = content.match(/href="([^"]+)"/g);
    if (links) {
      links.forEach(linkMatch => {
        const link = linkMatch.match(/href="([^"]+)"/)[1];
        if (link.endsWith('.html') && !link.startsWith('http')) {
          const dir = path.dirname(file);
          const linkPath = path.resolve(dir, link);
          if (!fs.existsSync(linkPath)) {
            console.error(`ERROR: Broken internal link in ${file}: ${link}`);
            errors++;
          }
        }
      });
    }
    console.log(`OK: ${file} verified.`);
  }
});

if (errors > 0) {
  process.exit(1);
} else {
  console.log('Integrity check passed!');
}
