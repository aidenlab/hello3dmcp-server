# Version Sync Cheat Sheet

Quick reference for keeping `package.json` and `manifest.json` versions in sync.

## Quick Start

The `scripts/sync-version.js` script automatically keeps versions synchronized between `package.json` and `manifest.json`. This ensures the version displayed in Claude Desktop's installation panel matches your package version.

---

## NPM Scripts (Recommended)

### Sync Versions
```bash
npm run version:sync
```
Copies the version from `package.json` to `manifest.json`. Use this if versions get out of sync.

### Bump Versions
```bash
npm run version:patch    # 0.1.0 → 0.1.1
npm run version:minor    # 0.1.0 → 0.2.0
npm run version:major    # 0.1.0 → 1.0.0
```
Bumps the version in both files according to semantic versioning.

### Set Specific Version
```bash
npm run version:set 2.0.0
```
Sets both files to a specific version (e.g., `2.0.0`).

---

## Direct Script Usage

You can also call the script directly:

```bash
# Sync from package.json to manifest.json
node scripts/sync-version.js

# Set specific version
node scripts/sync-version.js 1.2.3

# Bump versions
node scripts/sync-version.js --patch
node scripts/sync-version.js --minor
node scripts/sync-version.js --major
```

---

## Common Workflows

### Before Building a Release

1. **Bump version:**
   ```bash
   npm run version:patch
   ```

2. **Build the package:**
   ```bash
   npm run build
   ```

3. **The `.mcpb` file will include the updated version in `manifest.json`**

### Using npm version (Automatic)

The `preversion` hook automatically syncs versions before `npm version` runs:

```bash
npm version patch    # Automatically syncs, then bumps patch version
npm version minor    # Automatically syncs, then bumps minor version
npm version major    # Automatically syncs, then bumps major version
```

**Note:** The `preversion` hook syncs from `package.json` to `manifest.json` before npm bumps the version, ensuring both files stay aligned.

### Fixing Out-of-Sync Versions

If versions get out of sync:

```bash
npm run version:sync
```

This reads the version from `package.json` and updates `manifest.json` to match.

---

## Version Format

Versions must follow semantic versioning format: `X.Y.Z`

- **X** = Major version (breaking changes)
- **Y** = Minor version (new features, backward compatible)
- **Z** = Patch version (bug fixes, backward compatible)

Examples: `1.0.0`, `0.1.0`, `2.5.3`

---

## What Gets Updated

The script updates the `version` field in both:
- `package.json` → `"version": "X.Y.Z"`
- `manifest.json` → `"version": "X.Y.Z"`

The version in `manifest.json` is what appears in Claude Desktop's installation panel.

---

## Troubleshooting

### "Invalid version format" Error

Make sure you're using semantic versioning format:
- ✅ `1.2.3`
- ✅ `0.1.0`
- ❌ `1.2` (missing patch)
- ❌ `v1.2.3` (no "v" prefix)
- ❌ `1.2.3-beta` (prerelease not supported)

### Versions Still Out of Sync

1. Check both files manually:
   ```bash
   grep '"version"' package.json manifest.json
   ```

2. Force sync:
   ```bash
   npm run version:sync
   ```

3. Verify:
   ```bash
   grep '"version"' package.json manifest.json
   ```

---

## Tips

- **Always sync before building:** Run `npm run version:sync` or bump version before `npm run build`
- **Use npm scripts:** They're easier to remember than direct script calls
- **Check after manual edits:** If you manually edit `package.json`, run `npm run version:sync` to update `manifest.json`
- **Commit version changes:** Version bumps should be committed to git along with your code changes

