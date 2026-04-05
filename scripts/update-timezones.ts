#!/usr/bin/env npx tsx
/**
 * Update Timezone Cities Data
 *
 * Fetches the current list of IANA timezone identifiers from:
 * 1. Node.js Intl.supportedValuesOf('timeZone') - canonical list
 * 2. Adds UTC/GMT variants that browsers also recognize
 *
 * Usage:
 *   npm run update:timezones
 *
 * The IANA timezone database is updated several times per year to reflect
 * political changes to timezone rules. Running this script ensures the
 * fingerprinting library recognizes all current timezone identifiers.
 */

import * as fs from 'fs';
import * as path from 'path';

// UTC/GMT variants that should always be included
// These are recognized by browsers but may not be in Intl.supportedValuesOf
const UTC_GMT_VARIANTS = [
  'UTC',
  'GMT',
  'Etc/GMT+0',
  'Etc/GMT+1',
  'Etc/GMT+10',
  'Etc/GMT+11',
  'Etc/GMT+12',
  'Etc/GMT+2',
  'Etc/GMT+3',
  'Etc/GMT+4',
  'Etc/GMT+5',
  'Etc/GMT+6',
  'Etc/GMT+7',
  'Etc/GMT+8',
  'Etc/GMT+9',
  'Etc/GMT-1',
  'Etc/GMT-10',
  'Etc/GMT-11',
  'Etc/GMT-12',
  'Etc/GMT-13',
  'Etc/GMT-14',
  'Etc/GMT-2',
  'Etc/GMT-3',
  'Etc/GMT-4',
  'Etc/GMT-5',
  'Etc/GMT-6',
  'Etc/GMT-7',
  'Etc/GMT-8',
  'Etc/GMT-9',
  'Etc/GMT',
];

/**
 * Sort timezones in a logical order:
 * 1. UTC, GMT first
 * 2. Etc/GMT* variants
 * 3. Regional timezones alphabetically by region
 */
function sortTimezones(timezones: string[]): string[] {
  return timezones.sort((a, b) => {
    // UTC and GMT come first
    if (a === 'UTC') return -1;
    if (b === 'UTC') return 1;
    if (a === 'GMT') return -1;
    if (b === 'GMT') return 1;

    // Etc/* comes before regional
    const aIsEtc = a.startsWith('Etc/');
    const bIsEtc = b.startsWith('Etc/');
    if (aIsEtc && !bIsEtc) return -1;
    if (!aIsEtc && bIsEtc) return 1;

    // Alphabetical within groups
    return a.localeCompare(b);
  });
}

async function main() {
  console.log('=== Updating Timezone Cities Data ===\n');

  // Load existing data first - we'll merge, not replace
  const outputPath = path.join(__dirname, '..', 'public', 'data', 'timezone-cities.json');
  let existingTimezones: string[] = [];
  try {
    existingTimezones = JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as string[];
    console.log(`Existing timezones: ${existingTimezones.length}`);
  } catch {
    console.log('No existing timezone file found');
  }

  // Get timezones from Intl API (Node.js 18+)
  let intlTimezones: string[] = [];
  try {
    // @ts-ignore - supportedValuesOf is available in Node 18+
    intlTimezones = Intl.supportedValuesOf('timeZone');
    console.log(`Intl.supportedValuesOf returned ${intlTimezones.length} timezones`);
  } catch (e) {
    console.warn('Intl.supportedValuesOf not available, using fallback');
  }

  // Merge all sources - keep existing AND add new ones
  // This ensures we don't lose any timezones that browsers might recognize
  const allTimezones = new Set<string>([
    ...UTC_GMT_VARIANTS,
    ...existingTimezones,  // Keep all existing
    ...intlTimezones,      // Add any new from Intl
  ]);

  // Sort in logical order
  const sorted = sortTimezones([...allTimezones]);

  console.log(`Total unique timezones: ${sorted.length}`);

  // Calculate what's new (removed is now impossible since we merge)
  const existingSet = new Set(existingTimezones);
  const added = sorted.filter(tz => !existingSet.has(tz));

  // Show changes
  if (added.length > 0) {
    console.log(`\nAdded (${added.length}):`);
    added.forEach(tz => console.log(`  + ${tz}`));
  } else {
    console.log('\nNo new timezones found.');
  }

  // Write the file as a single-line JSON array (matches existing format)
  fs.writeFileSync(outputPath, JSON.stringify(sorted));
  console.log(`\nWritten: ${outputPath}`);

  // Also update the inline constant in constants.ts
  const constantsPath = path.join(__dirname, '..', 'src', 'timezone', 'constants.ts');
  try {
    let constantsContent = fs.readFileSync(constantsPath, 'utf-8');

    // Generate the inline array string
    const inlineArray = sorted.map(tz => `  '${tz}'`).join(',\n');
    const newConstant = `export const TIMEZONE_CITIES_INLINE = [\n${inlineArray},\n] as const;`;

    // Replace the existing TIMEZONE_CITIES_INLINE constant
    const regex = /export const TIMEZONE_CITIES_INLINE = \[[\s\S]*?\] as const;/;
    if (regex.test(constantsContent)) {
      constantsContent = constantsContent.replace(regex, newConstant);
      fs.writeFileSync(constantsPath, constantsContent);
      console.log(`Updated: ${constantsPath}`);
    } else {
      console.warn('Could not find TIMEZONE_CITIES_INLINE in constants.ts');
    }
  } catch (e) {
    console.warn('Could not update constants.ts:', e);
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Previous count: ${existingTimezones.length}`);
  console.log(`New count: ${sorted.length}`);
  console.log(`Added: ${added.length}`);

  // Show regional breakdown
  const regions = new Map<string, number>();
  for (const tz of sorted) {
    const region = tz.includes('/') ? tz.split('/')[0] : 'Other';
    regions.set(region, (regions.get(region) || 0) + 1);
  }

  console.log('\nBy region:');
  [...regions.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([region, count]) => {
      console.log(`  ${region}: ${count}`);
    });
}

main().catch(console.error);
