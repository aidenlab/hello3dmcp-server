#!/usr/bin/env node

/**
 * Sync version between package.json and manifest.json
 * 
 * Usage:
 *   node scripts/sync-version.js                    # Sync from package.json to manifest.json
 *   node scripts/sync-version.js 1.2.3            # Set both to 1.2.3
 *   node scripts/sync-version.js --patch          # Bump patch version (0.1.0 -> 0.1.1)
 *   node scripts/sync-version.js --minor          # Bump minor version (0.1.0 -> 0.2.0)
 *   node scripts/sync-version.js --major          # Bump major version (0.1.0 -> 1.0.0)
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const packageJsonPath = join(rootDir, 'package.json');
const manifestJsonPath = join(rootDir, 'manifest.json');

function parseVersion(version) {
  const parts = version.split('.').map(Number);
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function bumpVersion(version, type) {
  const { major, minor, patch } = parseVersion(version);
  
  switch (type) {
    case 'major':
      return formatVersion({ major: major + 1, minor: 0, patch: 0 });
    case 'minor':
      return formatVersion({ major, minor: minor + 1, patch: 0 });
    case 'patch':
      return formatVersion({ major, minor, patch: patch + 1 });
    default:
      throw new Error(`Unknown bump type: ${type}`);
  }
}

function readJson(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`❌ Error reading ${filePath}:`, error.message);
    process.exit(1);
  }
}

function writeJson(filePath, data) {
  try {
    const content = JSON.stringify(data, null, 2) + '\n';
    writeFileSync(filePath, content, 'utf-8');
  } catch (error) {
    console.error(`❌ Error writing ${filePath}:`, error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
let newVersion = null;
let bumpType = null;

if (args.length === 0) {
  // No arguments: sync from package.json to manifest.json
  const packageJson = readJson(packageJsonPath);
  newVersion = packageJson.version;
} else if (args[0] === '--patch' || args[0] === '--minor' || args[0] === '--major') {
  // Bump version
  bumpType = args[0].substring(2); // Remove '--'
  const packageJson = readJson(packageJsonPath);
  newVersion = bumpVersion(packageJson.version, bumpType);
} else {
  // Explicit version provided
  // Validate version format (basic check)
  if (!/^\d+\.\d+\.\d+/.test(args[0])) {
    console.error(`❌ Invalid version format: ${args[0]}`);
    console.error('   Expected format: X.Y.Z (e.g., 1.2.3)');
    process.exit(1);
  }
  newVersion = args[0];
}

// Read current files
const packageJson = readJson(packageJsonPath);
const manifestJson = readJson(manifestJsonPath);

// Update versions
const oldPackageVersion = packageJson.version;
const oldManifestVersion = manifestJson.version;

packageJson.version = newVersion;
manifestJson.version = newVersion;

// Write updated files
writeJson(packageJsonPath, packageJson);
writeJson(manifestJsonPath, manifestJson);

// Print results
console.log('✅ Version synced successfully!');
if (bumpType) {
  console.log(`   Bumped ${bumpType} version: ${oldPackageVersion} → ${newVersion}`);
} else if (oldPackageVersion !== oldManifestVersion) {
  console.log(`   package.json: ${oldPackageVersion} → ${newVersion}`);
  console.log(`   manifest.json: ${oldManifestVersion} → ${newVersion}`);
} else {
  console.log(`   Both files updated to: ${newVersion}`);
}

