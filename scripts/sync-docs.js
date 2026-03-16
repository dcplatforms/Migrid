/**
 * MiGrid Documentation Synchronizer
 * Executes the "Single Source of Truth" protocol by calculating the true
 * platform completion percentage from PLATFORM_STATUS.md and injecting
 * it into README.md and the HTML documentation.
 */

const fs = require('fs');
const path = require('path');

// File Paths
const STATUS_FILE = path.join(__dirname, '../PLATFORM_STATUS.md');
const README_FILE = path.join(__dirname, '../README.md');
const ROADMAP_HTML = path.join(__dirname, '../docs/roadmap.html');
const ARCH_HTML = path.join(__dirname, '../docs/architecture.html');
const MIGRID_DOCS_ROADMAP_HTML = path.join(__dirname, '../migrid-docs-roadmap.html');

const VERSION = "10.1.0";
const DATE = "March 2026";

function syncDocumentation() {
    console.log('[Meta-PO] Initiating Documentation Sync...');

    try {
        // 1. Read the Source of Truth
        const statusContent = fs.readFileSync(STATUS_FILE, 'utf8');

        // Extract only the Feature Audit section to avoid counting badges or accomplishments
        const auditSectionMatch = statusContent.match(/## Platform Truth: Feature Audit([\s\S]*?)---/);
        if (!auditSectionMatch) {
            throw new Error('Could not find Feature Audit section in PLATFORM_STATUS.md');
        }
        const auditSection = auditSectionMatch[1];

        // Calculate features based on Markdown checkboxes in the audit section
        const completedFeatures = (auditSection.match(/^- \[[xX✓]\] /gm) || []).length;
        const plannedFeatures = (auditSection.match(/^- \[ \] /gm) || []).length;
        const inProgressFeatures = (auditSection.match(/^- \[[-~]\] /gm) || []).length;

        const totalFeatures = completedFeatures + plannedFeatures + inProgressFeatures;

        if (totalFeatures === 0) {
            throw new Error('No features found in Feature Audit. Check formatting.');
        }

        const completionPercentage = Math.round((completedFeatures / totalFeatures) * 100);

        console.log(`[Meta-PO] Mathematical Truth Extracted:`);
        console.log(` > Completed: ${completedFeatures}`);
        console.log(` > In Progress: ${inProgressFeatures}`);
        console.log(` > Planned: ${plannedFeatures}`);
        console.log(` > Overall Completion: ${completionPercentage}%`);

        // 1.5 Update PLATFORM_STATUS.md header badges and metrics
        let updatedStatusContent = statusContent;
        const statusProgressBadgeRegex = /(https:\/\/img\.shields\.io\/badge\/Progress-)\d+%25_Complete(-blue\.svg)/;
        updatedStatusContent = updatedStatusContent.replace(statusProgressBadgeRegex, `$1${completionPercentage}%25_Complete$2`);

        const statusFeaturesBadgeRegex = /(https:\/\/img\.shields\.io\/badge\/Features-)\d+%2F\d+(-brightgreen\.svg)/;
        updatedStatusContent = updatedStatusContent.replace(statusFeaturesBadgeRegex, `$1${completedFeatures}%2F${totalFeatures}$2`);

        const statusMetricsRegex = /(Overall Progress:\s+)[█░\s]+\d+%/;
        const barLength = 20;
        const filledLength = Math.round((completionPercentage / 100) * barLength);
        const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
        updatedStatusContent = updatedStatusContent.replace(statusMetricsRegex, `$1${bar} ${completionPercentage}%`);

        const statusDeliveredRegex = /\*\*(\d+) of (\d+) features\*\* delivered/;
        updatedStatusContent = updatedStatusContent.replace(statusDeliveredRegex, `**${completedFeatures} of ${totalFeatures} features** delivered`);

        const statusRoadmapProgressRegex = /(Overall Progress:\s+)[█░\s]+\d+%/g;
        updatedStatusContent = updatedStatusContent.replace(statusRoadmapProgressRegex, `$1${bar} ${completionPercentage}%`);

        fs.writeFileSync(STATUS_FILE, updatedStatusContent);
        console.log(`[Meta-PO] Successfully patched PLATFORM_STATUS.md`);

        // 2. Update README.md
        let readmeContent = fs.readFileSync(README_FILE, 'utf8');

        // Update version and date in the badges/text
        const readmeRegex = /(\*\*Version )\d+\.\d+\.\d+(\*\* • \*\*)[a-zA-Z]+ \d{4}(\*\* • \*\*)\d+(% Complete\*\*)/g;
        readmeContent = readmeContent.replace(readmeRegex, `$1${VERSION}$2${DATE}$3${completionPercentage}$4`);

        // Update the Features badge
        const featuresBadgeRegex = /(https:\/\/img\.shields\.io\/badge\/Features-)\d+%2F\d+(-blue\.svg)/g;
        readmeContent = readmeContent.replace(featuresBadgeRegex, `$1${completedFeatures}%2F${totalFeatures}$2`);

        // Update the Platform percentage badge
        const platformBadgeRegex = /(https:\/\/img\.shields\.io\/badge\/platform-)\d+%25%20complete(-orange\.svg)/g;
        readmeContent = platformBadgeRegex.test(readmeContent)
            ? readmeContent.replace(platformBadgeRegex, `$1${completionPercentage}%25%20complete$2`)
            : readmeContent.replace(/(https:\/\/img\.shields\.io\/badge\/Progress-)\d+%25%20Complete(-blue\.svg)/g, `$1${completionPercentage}%25%20Complete$2`);

        // Update the Services badge
        const servicesBadgeRegex = /(https:\/\/img\.shields\.io\/badge\/Services-)\d+%2F\d+_Complete(-green\.svg)/g;
        readmeContent = readmeContent.replace(servicesBadgeRegex, `$111%2F11_Complete$2`);

        fs.writeFileSync(README_FILE, readmeContent);
        console.log(`[Meta-PO] Successfully patched README.md`);

        // 3. Update roadmap.html
        if (fs.existsSync(ROADMAP_HTML)) {
            let htmlContent = fs.readFileSync(ROADMAP_HTML, 'utf8');

            // Update summary stats
            htmlContent = htmlContent.replace(/(text-3xl font-bold text-white mb-1">)\d+(<\/div>\s*<div[^>]*>Complete<\/div>)/i, `$1${completedFeatures}$2`);
            htmlContent = htmlContent.replace(/(text-3xl font-bold text-white mb-1">)\d+(<\/div>\s*<div[^>]*>In Progress<\/div>)/i, `$1${inProgressFeatures}$2`);
            htmlContent = htmlContent.replace(/(text-3xl font-bold text-white mb-1">)\d+(<\/div>\s*<div[^>]*>Planned<\/div>)/i, `$1${plannedFeatures}$2`);
            htmlContent = htmlContent.replace(/(text-3xl font-bold text-white mb-1">)\d+%(<\/div>\s*<div[^>]*>Overall<\/div>)/i, `$1${completionPercentage}%$2`);

            // Update header badges
            htmlContent = htmlContent.replace(/(<span[^>]*>)(v\d+\.\d+\.\d+)(<\/span>)/i, `$1v${VERSION}$3`);

            // Update footer
            htmlContent = htmlContent.replace(/(Last Updated: )[a-zA-Z]+ \d{4}( • Version )\d+\.\d+\.\d+/i, `$1${DATE}$2${VERSION}`);

            fs.writeFileSync(ROADMAP_HTML, htmlContent);
            console.log(`[Meta-PO] Successfully patched docs/roadmap.html`);
        }

        // 4. Update architecture.html
        if (fs.existsSync(ARCH_HTML)) {
            let htmlContent = fs.readFileSync(ARCH_HTML, 'utf8');

            // Update Header Version & Completion
            htmlContent = htmlContent.replace(/(<span[^>]*>)(v\d+\.\d+\.\d+)(<\/span>)/i, `$1v${VERSION}$3`);
            htmlContent = htmlContent.replace(/(<span[^>]*>)\d+% Complete(<\/span>)/i, `$1${completionPercentage}% Complete$2`);

            // Update Stats built percentage
            htmlContent = htmlContent.replace(/(text-3xl font-bold text-emerald-400">)\d+%(<\/div>)/i, `$1${completionPercentage}%$2`);

            fs.writeFileSync(ARCH_HTML, htmlContent);
            console.log(`[Meta-PO] Successfully patched docs/architecture.html`);
        }

        // 5. Update migrid-docs-roadmap.html
        if (fs.existsSync(MIGRID_DOCS_ROADMAP_HTML)) {
            let htmlContent = fs.readFileSync(MIGRID_DOCS_ROADMAP_HTML, 'utf8');

            // Update Stats
            htmlContent = htmlContent.replace(/(<div[^>]*text-4xl font-bold text-emerald-400">)\d+(<\/div>)/i, `$1${completedFeatures}$2`);
            htmlContent = htmlContent.replace(/(<div[^>]*text-4xl font-bold text-amber-400">)\d+(<\/div>)/i, `$1${inProgressFeatures}$2`);
            htmlContent = htmlContent.replace(/(<div[^>]*text-4xl font-bold text-slate-400">)\d+(<\/div>)/i, `$1${plannedFeatures}$2`);

            // Update Built percentage in legend
            htmlContent = htmlContent.replace(/(Platform Built: <span[^>]*>)\d+%(<\/span>)/i, `$1${completionPercentage}%$2`);
            htmlContent = htmlContent.replace(/(Last Update: )[a-zA-Z]+ \d{4}/i, `$1${DATE}`);

            fs.writeFileSync(MIGRID_DOCS_ROADMAP_HTML, htmlContent);
            console.log(`[Meta-PO] Successfully patched migrid-docs-roadmap.html`);
        }

        console.log('[Meta-PO] Sync Complete. The Platform reflects reality.');

    } catch (error) {
        console.error('[Meta-PO] FATAL ERROR during sync:', error.message);
        process.exit(1);
    }
}

syncDocumentation();
