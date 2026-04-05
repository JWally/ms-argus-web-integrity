/**
 * Script to strip HTML rendering functions from all modules
 *
 * This script:
 * 1. Reads each module file
 * 2. Removes the exported HTML function (e.g., navigatorHTML, screenHTML)
 * 3. Removes unused html.ts imports
 * 4. Preserves data collection functions
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');

// Modules to process and their HTML function names
const modules = [
  { dir: 'audio', htmlFn: 'audioHTML' },
  { dir: 'canvas', htmlFn: 'canvasHTML' },
  { dir: 'css', htmlFn: 'cssHTML' },
  { dir: 'cssmedia', htmlFn: 'cssMediaHTML' },
  { dir: 'document', htmlFn: 'htmlElementVersionHTML' },
  { dir: 'domrect', htmlFn: 'clientRectsHTML' },
  { dir: 'engine', htmlFn: 'consoleErrorsHTML' },
  { dir: 'features', htmlFn: 'featuresHTML' },
  { dir: 'fonts', htmlFn: 'fontsHTML' },
  { dir: 'headless', htmlFn: 'headlessFeaturesHTML' },
  { dir: 'intl', htmlFn: 'intlHTML' },
  { dir: 'math', htmlFn: 'mathsHTML' },
  { dir: 'media', htmlFn: 'mediaHTML' },
  { dir: 'navigator', htmlFn: 'navigatorHTML' },
  { dir: 'resistance', htmlFn: 'resistanceHTML' },
  { dir: 'speech', htmlFn: 'voicesHTML' },
  { dir: 'status', htmlFn: 'statusHTML' },
  { dir: 'svg', htmlFn: 'svgHTML' },
  { dir: 'timezone', htmlFn: 'timezoneHTML' },
  { dir: 'webgl', htmlFn: 'webglHTML' },
  { dir: 'webrtc', htmlFn: 'webrtcHTML' },
  { dir: 'window', htmlFn: 'windowFeaturesHTML' },
  { dir: 'worker', htmlFn: 'workerScopeHTML' },
  // Note: screen was already done manually
  // Note: lies, trash, errors, samples, prediction have different patterns
];

function stripHtmlFromModule(modulePath, htmlFnName) {
  let content = fs.readFileSync(modulePath, 'utf8');
  const originalContent = content;

  // Find and remove the HTML function
  // Pattern: export function htmlFnName(... { ... } at the end of file or followed by another export
  const htmlFnRegex = new RegExp(
    `export function ${htmlFnName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\}\\s*$`,
    'gm'
  );

  // More robust: find the function start, then count braces to find the end
  const fnStartRegex = new RegExp(`export function ${htmlFnName}\\s*\\(`);
  const match = content.match(fnStartRegex);

  if (match) {
    const startIdx = match.index;
    let braceCount = 0;
    let inString = false;
    let stringChar = '';
    let endIdx = startIdx;

    // Find opening brace
    let i = startIdx;
    while (i < content.length && content[i] !== '{') i++;

    // Count braces to find matching close
    for (; i < content.length; i++) {
      const char = content[i];
      const prevChar = content[i - 1];

      // Handle string literals
      if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          inString = false;
        }
        continue;
      }

      if (inString) continue;

      if (char === '{') braceCount++;
      if (char === '}') braceCount--;

      if (braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }

    // Remove the function and any trailing whitespace/newlines
    content = content.slice(0, startIdx) + content.slice(endIdx).replace(/^\s*\n/, '\n');
  }

  // Clean up html.ts imports
  // Remove: HTMLNote, modal, count, getDiffs, pluralify (UI-only)
  // Keep: patch, html (needed for DOM element creation in data collection)
  const htmlImportRegex = /import\s*\{([^}]+)\}\s*from\s*['"]\.\.?\/utils\/html['"]/;
  const importMatch = content.match(htmlImportRegex);

  if (importMatch) {
    const imports = importMatch[1].split(',').map(s => s.trim());

    // Filter out UI-only imports
    const uiOnlyImports = ['HTMLNote', 'modal', 'count', 'getDiffs', 'pluralify'];
    const keptImports = imports.filter(imp => !uiOnlyImports.includes(imp));

    if (keptImports.length === 0) {
      // Remove the entire import line
      content = content.replace(htmlImportRegex, '');
      // Clean up empty lines
      content = content.replace(/\n\n\n+/g, '\n\n');
    } else {
      // Update the import to only include kept imports
      const newImport = `import { ${keptImports.join(', ')} } from '../utils/html'`;
      content = content.replace(htmlImportRegex, newImport);
    }
  }

  // Remove unused helper imports (performanceLogger, hashSlice, formatEmojiSet)
  // These are only used in HTML rendering functions
  const helpersImportRegex = /import\s*\{([^}]+)\}\s*from\s*['"]\.\.?\/utils\/helpers['"]/;
  const helpersMatch = content.match(helpersImportRegex);

  if (helpersMatch) {
    const imports = helpersMatch[1].split(',').map(s => s.trim());

    // Check which helpers are still used in the remaining code
    const uiOnlyHelpers = ['performanceLogger', 'hashSlice', 'formatEmojiSet'];
    const keptImports = imports.filter(imp => {
      if (!uiOnlyHelpers.includes(imp)) return true;

      // Check if it's used elsewhere in the code (after removing HTML function)
      const regex = new RegExp(`\\b${imp}\\b`);
      return regex.test(content);
    });

    if (keptImports.length !== imports.length) {
      const newImport = `import { ${keptImports.join(', ')} } from '../utils/helpers'`;
      content = content.replace(helpersImportRegex, newImport);
    }
  }

  // Clean up trailing whitespace and multiple newlines
  content = content.replace(/\n\n\n+/g, '\n\n');
  content = content.replace(/\n+$/, '\n');

  if (content !== originalContent) {
    fs.writeFileSync(modulePath, content);
    return true;
  }
  return false;
}

console.log('Stripping HTML functions from modules...\n');

let processed = 0;
let skipped = 0;

for (const mod of modules) {
  const modulePath = path.join(srcDir, mod.dir, 'index.ts');

  if (!fs.existsSync(modulePath)) {
    console.log(`  SKIP: ${mod.dir} (file not found)`);
    skipped++;
    continue;
  }

  const content = fs.readFileSync(modulePath, 'utf8');

  // Check if HTML function exists
  if (!content.includes(`export function ${mod.htmlFn}`)) {
    console.log(`  SKIP: ${mod.dir} (no ${mod.htmlFn} found)`);
    skipped++;
    continue;
  }

  try {
    const changed = stripHtmlFromModule(modulePath, mod.htmlFn);
    if (changed) {
      console.log(`  OK:   ${mod.dir} - removed ${mod.htmlFn}`);
      processed++;
    } else {
      console.log(`  SKIP: ${mod.dir} (no changes needed)`);
      skipped++;
    }
  } catch (error) {
    console.log(`  ERR:  ${mod.dir} - ${error.message}`);
    skipped++;
  }
}

console.log(`\nDone! Processed: ${processed}, Skipped: ${skipped}`);

// Also handle special modules: lies, trash, errors, samples, prediction
console.log('\nNote: You may need to manually check these modules:');
console.log('  - lies/index.ts (uses modal for display)');
console.log('  - trash/index.ts (uses modal for display)');
console.log('  - errors/index.ts (uses modal for display)');
console.log('  - samples/index.ts (may have different structure)');
console.log('  - prediction/index.ts (may have different structure)');
