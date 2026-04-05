/**
 * Clean unused imports from module files
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');

// Unused imports to remove
const unusedImports = ['hashSlice', 'formatEmojiSet', 'performanceLogger'];

function cleanImports(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;

  // Match import statements from helpers
  const helperImportRegex = /import\s*\{([^}]+)\}\s*from\s*['"]\.\.?\/utils\/helpers['"]/g;

  content = content.replace(helperImportRegex, (match, imports) => {
    const importList = imports.split(',').map(s => s.trim()).filter(Boolean);
    const cleanedImports = importList.filter(imp => !unusedImports.includes(imp));

    if (cleanedImports.length === 0) {
      return ''; // Remove entire import
    }

    return `import { ${cleanedImports.join(', ')} } from '../utils/helpers'`;
  });

  // Clean up empty lines
  content = content.replace(/\n\n\n+/g, '\n\n');

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content);
    return true;
  }
  return false;
}

// Find all TypeScript files
function findTsFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      files.push(...findTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

console.log('Cleaning unused imports...\n');

const files = findTsFiles(srcDir);
let cleaned = 0;

for (const file of files) {
  if (cleanImports(file)) {
    console.log(`  Cleaned: ${path.relative(srcDir, file)}`);
    cleaned++;
  }
}

console.log(`\nCleaned ${cleaned} files`);
