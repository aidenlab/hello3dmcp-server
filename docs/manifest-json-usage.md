# How manifest.json Works: From Source to .mcpb Package

This document explains how `manifest.json` is used throughout the build and installation process.

## Overview

The `manifest.json` file serves as the **package configuration** that tells MCP clients (like Claude Desktop) how to run your server. It's included in the `.mcpb` package and read by the client when installing.

## Step-by-Step Flow

### Step 1: Development Phase (manifest.json as Configuration)

During development, `manifest.json` exists in your project root but is **not actively used** by your running server. Instead:

- Your server (`server.js`) reads from:
  1. Command-line arguments (`--browser-url`)
  2. Environment variables (`BROWSER_URL`, `MCP_PORT`, `WS_PORT`)
  3. Default values

- `manifest.json` is just a **template** that will be packaged later

**Current manifest.json structure:**
```json
{
  "manifest_version": "0.1",
  "name": "hello3dmcp-server",
  "version": "0.0.0",
  "description": "MCP server for controlling 3D model visualization...",
  "author": { "name": "Douglass Turner" },
  "server": {
    "type": "node",
    "entry_point": "dist/hello3dmcp-server.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/hello3dmcp-server.js"],
      "env": {
        "BROWSER_URL": "https://hello3dllm.netlify.app/",
        "MCP_PORT": "3000",
        "WS_PORT": "3001"
      }
    }
  }
}
```

**Key fields explained:**
- `manifest_version`: Version of the manifest format (currently "0.1")
- `name`: Package name (used for identification)
- `version`: Package version
- `server.entry_point`: Path to the bundled server file (relative to package root)
- `server.mcp_config.command`: Command to run (e.g., "node")
- `server.mcp_config.args`: Arguments to pass, including `${__dirname}` placeholder
- `server.mcp_config.env`: **Default environment variables** that will be set when the server runs

---

### Step 2: Build Process (`npm run build`)

When you run `npm run build`, two things happen:

#### 2.1 Bundle Creation (`esbuild.config.js`)

```bash
node esbuild.config.js
```

This:
1. Bundles `server.js` and all dependencies into `dist/hello3dmcp-server.js`
2. Handles Node.js built-ins (keeps them external)
3. Creates a self-contained bundle

**Output:** `dist/hello3dmcp-server.js` (the actual server code)

#### 2.2 Package Creation (`build-mcpb.js`)

```bash
node build-mcpb.js
```

This script:
1. Creates a ZIP archive named `hello3dmcp-server.mcpb`
2. Adds `manifest.json` to the root of the archive
3. Adds the entire `dist/` directory to the archive

**build-mcpb.js code:**
```javascript
import fs from 'fs';
import archiver from 'archiver';

const output = fs.createWriteStream('hello3dmcp-server.mcpb');
const archive = archiver('zip', { zlib: { level: 9 } });

archive.pipe(output);
archive.file('manifest.json', { name: 'manifest.json' });  // ← manifest.json goes in root
archive.directory('dist/', 'dist');                        // ← dist/ goes in dist/ folder
archive.finalize();
```

**Resulting .mcpb file structure:**
```
hello3dmcp-server.mcpb (ZIP archive)
├── manifest.json                    ← Configuration file
└── dist/
    └── hello3dmcp-server.js         ← Bundled server code
```

---

### Step 3: Installation in Claude Desktop

When a user installs `hello3dmcp-server.mcpb` in Claude Desktop:

1. **Claude Desktop extracts the .mcpb file** (it's just a ZIP)
2. **Claude Desktop reads `manifest.json`** from the extracted package
3. **Claude Desktop uses the manifest to configure the server**

#### How Claude Desktop Uses manifest.json:

**From `server.mcp_config`:**
- `command`: "node" → Claude Desktop runs `node`
- `args`: `["${__dirname}/dist/hello3dmcp-server.js"]` → Claude Desktop replaces `${__dirname}` with the actual package directory and passes this as an argument
- `env`: Claude Desktop sets these as environment variables before starting the server

**Example of what Claude Desktop does internally:**
```javascript
// Pseudo-code of what Claude Desktop does
const packageDir = '/path/to/extracted/package';
const manifest = JSON.parse(fs.readFileSync(`${packageDir}/manifest.json`));

// Replace ${__dirname} placeholder
const args = manifest.server.mcp_config.args.map(arg => 
  arg.replace('${__dirname}', packageDir)
);
// Result: ["/path/to/extracted/package/dist/hello3dmcp-server.js"]

// Set environment variables from manifest
Object.assign(process.env, manifest.server.mcp_config.env);
// Result: BROWSER_URL="https://hello3dllm.netlify.app/", etc.

// Start the server
spawn(manifest.server.mcp_config.command, args, {
  env: process.env  // Includes manifest.env values
});
```

---

### Step 4: Server Runtime

When the server starts (via Claude Desktop):

1. **Environment variables are already set** from `manifest.json`'s `env` section
2. **Your server code reads them** via `process.env.BROWSER_URL`, etc.

**In your server.js:**
```javascript
// These values come from manifest.json's env section (if not overridden)
const BROWSER_URL = cliArgs.browserUrl || process.env.BROWSER_URL || 'http://localhost:5173';
const MCP_PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000;
const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3001;
```

**Priority order (from your server code):**
1. Command-line arguments (highest priority)
2. Environment variables (set by Claude Desktop from manifest.json)
3. Default values (lowest priority)

---

## Key Points

### 1. manifest.json is NOT read by your server code

Your `server.js` does **not** read `manifest.json` directly. Instead:
- Claude Desktop reads `manifest.json` and sets environment variables
- Your server reads those environment variables via `process.env`

### 2. Environment Variable Flow

```
manifest.json (env section)
    ↓
Claude Desktop extracts and reads manifest
    ↓
Claude Desktop sets process.env from manifest.env
    ↓
Your server reads process.env.BROWSER_URL, etc.
```

### 3. ${__dirname} Placeholder

The `${__dirname}` placeholder in `args` is replaced by Claude Desktop with the actual package directory. This allows the package to work regardless of where it's installed.

### 4. Overriding manifest.json Values

Users can override values from `manifest.json`:
- **System environment variables** (set before starting Claude Desktop) take precedence
- **Command-line arguments** (if your server supports them) take highest precedence

---

## Example: Complete Flow

1. **Developer edits manifest.json:**
   ```json
   "env": {
     "BROWSER_URL": "https://hello3dllm.netlify.app/"
   }
   ```

2. **Developer runs build:**
   ```bash
   npm run build
   ```
   - Bundles server → `dist/hello3dmcp-server.js`
   - Packages → `hello3dmcp-server.mcpb` (contains manifest.json + dist/)

3. **User installs package:**
   - Claude Desktop extracts `.mcpb`
   - Claude Desktop reads `manifest.json`
   - Claude Desktop sets `BROWSER_URL=https://hello3dllm.netlify.app/` as environment variable

4. **Server starts:**
   - Claude Desktop runs: `node /path/to/package/dist/hello3dmcp-server.js`
   - Server reads `process.env.BROWSER_URL` → gets `"https://hello3dllm.netlify.app/"`
   - Server uses this URL for browser connections

---

## Summary

- **manifest.json** = Package configuration file
- **build-mcpb.js** = Packages manifest.json + dist/ into .mcpb ZIP
- **Claude Desktop** = Reads manifest.json and uses it to start your server
- **Your server** = Reads environment variables (set by Claude Desktop from manifest.json)

The manifest.json is the **bridge** between your package and the MCP client, telling it how to run your server and what default configuration to use.

