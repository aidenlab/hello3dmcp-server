# Claude Desktop Setup Guide

Claude Desktop is Anthropic's free desktop application that supports MCP servers. This guide covers setting up the Hello3DLLM MCP server with Claude Desktop.

## Prerequisites

- Node.js (v18 or higher)
- npm
- Claude Desktop installed (download from https://claude.ai/download)
- **Default setup:** Uses localhost (no additional setup required)
- **For Netlify setup (optional/advanced):** Requires localtunnel and Netlify deployment - see [Using Netlify Instead of Localhost](#using-netlify-instead-of-localhost-optional) section

---

## Installation Methods

Claude Desktop supports **two installation methods**:

1. **MCP Package (`.mcpb`)** - Simplest method, recommended for distribution
2. **Manual Configuration** - For development or custom setups

---

## Option 1: MCP Package Installation (`.mcpb`) - Recommended

This is the **simplest installation method** - just install the package file and Claude Desktop handles everything automatically.

### Prerequisites

- Claude Desktop installed (download from https://claude.ai/download)
- The `hello3dmcp-server.mcpb` package file (created by running `npm run build`)

### Step-by-Step Installation

1. **Build the package** (if you haven't already):
   ```bash
   npm run build
   ```
   This creates `hello3dmcp-server.mcpb` in your project root.

2. **Install in Claude Desktop:**
   - Open Claude Desktop
   - Go to **Settings** → **Extensions** → **Advanced Settings**
   - Click **"Install Extension"** button
   - Select the `hello3dmcp-server.mcpb` file
   - Claude Desktop will automatically extract and configure the server

3. **Restart Claude Desktop:**
   - Quit Claude Desktop completely
   - Reopen Claude Desktop
   - The MCP server will start automatically

4. **Verify the connection:**
   - In Claude Desktop, ask: "What tools do you have available?"
   - Claude should list your MCP tools (e.g., `change_model_color`, `change_model_size`, etc.)

5. **Configure the browser URL (if needed):**
   - The package includes default configuration in `manifest.json`:
     - `BROWSER_URL`: `http://localhost:5173` (default)
     - `MCP_PORT`: `3000`
     - `WS_PORT`: `3001`
   - To override defaults, set system environment variables before starting Claude Desktop:
     ```bash
     export BROWSER_URL=https://your-app.netlify.app
     ```
   - Or modify the `manifest.json` before building the package

6. **Start your 3D app:**
   ```bash
   npm run dev
   ```
   This starts the development server on `http://localhost:5173`

7. **Connect to the 3D app:**
   - Ask Claude Desktop: "How do I connect to the 3D app?" or "Get browser URL"
   - Claude will provide a URL with your unique session ID
   - Open that URL in your browser

### Benefits of `.mcpb` Installation

- **No manual configuration** - No need to edit config files or specify paths
- **Self-contained** - All dependencies bundled, no Node.js/npm required
- **Easy updates** - Just rebuild and reinstall the package
- **Clean installation** - Everything managed by Claude Desktop

### Troubleshooting `.mcpb` Installation

#### Package Not Installing
- Verify the `.mcpb` file was created successfully (`npm run build`)
- Check that Claude Desktop is up to date (supports `.mcpb` packages)
- Try restarting Claude Desktop

#### Server Not Starting
- Check Claude Desktop logs: `~/Library/Logs/Claude/mcp-server-hello3dmcp-server.log` (macOS)
- Verify ports 3000 and 3001 are available
- Check that Node.js is installed (required to run the bundled server)

#### Tools Not Appearing
- Restart Claude Desktop completely
- Verify the package installed successfully in Settings → Extensions
- Check logs for errors

---

## Option 2: Manual Configuration (For Development)

For development or custom setups, you can configure Claude Desktop manually.

### Connection Modes

Claude Desktop supports **two connection modes**:

1. **Subprocess Mode** (Recommended for localhost) - Claude Desktop manages the server process automatically
2. **HTTP/SSE Mode** (For remote/tunneled servers) - Connect to an already-running server

---

### Option 2A: Subprocess Mode (Recommended for Localhost)

This is the simplest setup - Claude Desktop will start and manage your server automatically.

### Step-by-Step Setup

1. **Clean up any existing processes:**
   - See [Clean Up Existing Processes](#clean-up-existing-processes-start-with-a-clean-slate) section below
   - Make sure ports 3000 and 3001 are free
   - If you have `node server.js` running in a terminal, stop it (Ctrl+C)
   - Claude Desktop will start the server automatically
   - Having both running will cause port conflicts

2. **Locate Claude Desktop configuration file:**

   **macOS:**
   ```
   ~/Library/Application Support/Claude/claude_desktop_config.json
   ```
   
   **Windows:**
   ```
   %APPDATA%\Claude\claude_desktop_config.json
   ```
   
   **Linux:**
   ```
   ~/.config/Claude/claude_desktop_config.json
   ```

3. **Edit the configuration file:**

   If the file doesn't exist, create it. Add the `mcpServers` section with subprocess configuration:
   
   ```json
   {
     "mcpServers": {
       "3d-model-server": {
         "command": "node",
         "args": ["/Users/turner/MCPDevelopment/Hello3DLLM/server.js"]
       }
     }
   }
   ```
   
   ⚠️ **Important:** 
   - Replace `/Users/turner/MCPDevelopment/Hello3DLLM/server.js` with the **absolute path** to your `server.js` file
   - Use `node` command (or full path like `/Users/turner/.nvm/versions/node/v22.14.0/bin/node` if using nvm)
   - Make sure no other instance of the server is running

4. **Restart Claude Desktop:**
   - Quit Claude Desktop completely
   - Reopen Claude Desktop
   - Claude Desktop will automatically start your MCP server

5. **Verify the connection:**
   - In Claude Desktop, ask: "What tools do you have available?"
   - Claude should list your MCP tools (e.g., `change_model_color`, `change_model_size`, etc.)
   - Check Claude Desktop logs if there are issues: `~/Library/Logs/Claude/mcp-server-3d-model-server.log` (macOS)

6. **Start your local 3D app:**
   ```bash
   npm run dev
   ```
   This starts the development server on `http://localhost:5173`
   - The `.env` file (created automatically) defaults to `BROWSER_URL=http://localhost:5173`
   - No additional configuration needed for localhost setup

7. **Connect to the 3D app:**
   - Ask Claude Desktop: "How do I connect to the 3D app?" or "Get browser URL"
   - Claude will provide a localhost URL with your unique session ID (e.g., `http://localhost:5173?sessionId=<unique-uuid>`)
   - Copy and paste the URL into your browser
   - The browser will connect to your Claude Desktop session
   - **Note:** Each Claude Desktop process gets its own unique UUID session ID, ensuring proper session isolation

**Default Configuration:**
- The `.env` file defaults to `BROWSER_URL=http://localhost:5173`
- No WebSocket tunnel needed for localhost (browser connects directly to `ws://localhost:3001`)
- Simple setup - just run `npm run dev` and connect!

---

### Using Netlify Instead of Localhost (Optional/Advanced)

⚠️ **Note:** The default setup uses localhost, which is simpler and doesn't require tunneling. Netlify setup is optional and more complex.

If you want to use your Netlify-hosted app instead of running locally:

1. **Update `.env` file** in your project root:
   ```bash
   # Change BROWSER_URL to your Netlify URL
   BROWSER_URL=https://your-app.netlify.app
   ```
   
   Replace `https://your-app.netlify.app` with your actual Netlify URL.
   
   **Why `.env` file?** This is the recommended approach for Claude Desktop because:
   - Claude Desktop starts the server automatically, so you can't easily pass command-line arguments
   - Environment variables set in your shell profile won't be available to Claude Desktop's subprocess
   - The `.env` file is automatically loaded by `server.js` when it starts
   - No need to modify shell profiles or restart terminals
   
   **Configuration Priority:** The server uses this priority order:
   1. Command line argument (`--browser-url`)
   2. Environment variable (`BROWSER_URL`)
   3. `.env` file (`BROWSER_URL`)
   4. Default (`http://localhost:5173`)

2. **Install localtunnel** (if not already installed):
   ```bash
   npm install -g localtunnel
   ```

3. **Create WebSocket tunnel** (so Netlify can connect to your local WebSocket):
   
   **Important:** You must use a tunnel with a specific subdomain so the URL remains consistent. Use **localtunnel** (not ngrok) because:
   - Localtunnel's free tier allows you to specify a custom subdomain
   - Ngrok's free tier does NOT allow custom subdomains (URLs change on every restart)
   - A stable URL is required for Netlify environment variables
   
   Run localtunnel with the specific subdomain:
   ```bash
   lt --port 3001 --subdomain hello3dllm-websocket
   ```
   
   This creates the tunnel URL: `https://hello3dllm-websocket.loca.lt`
   
   **Note:** Keep this tunnel running while using the app. The tunnel URL will remain stable as long as you use the same subdomain.
   
   **Why not ngrok?** Ngrok's free tier doesn't support custom subdomains, so the URL changes every time you restart it. This would require updating Netlify's `VITE_WS_URL` environment variable each time, making it impractical for this use case.

4. **Configure Netlify:**
   - Go to your Netlify site settings
   - Add environment variable: `VITE_WS_URL=wss://hello3dllm-websocket.loca.lt`
   - **Important:** Use `wss://` (WebSocket Secure) protocol, not `https://`
   - Redeploy your site

5. **Restart Claude Desktop** (to pick up the configuration from `.env` file)

6. **Connect:**
   - Ask Claude Desktop: "How do I connect to the 3D app?"
   - It will provide a Netlify URL with your unique session ID (e.g., `https://your-app.netlify.app?sessionId=<unique-uuid>`)
   - Open that URL in your browser
   - **Note:** Each Claude Desktop process gets its own unique UUID session ID, ensuring proper session isolation

**Important Notes:**
- **Keep the tunnel running:** The `lt --port 3001 --subdomain hello3dllm-websocket` command must stay running while you're using the app
- **Stable URL:** Using the specific subdomain ensures the URL (`https://hello3dllm-websocket.loca.lt`) remains consistent
- **If tunnel disconnects:** If the tunnel stops, restart it with the same command and ensure Netlify has the correct `VITE_WS_URL` environment variable set

---

### Troubleshooting Subprocess Mode

#### Port Already in Use Error
- See [Clean Up Existing Processes](#clean-up-existing-processes-start-with-a-clean-slate) section below for detailed commands
- Make sure you've stopped any manually running server instances
- Check if port 3000 or 3001 is in use and kill any processes using those ports
- **macOS/Linux:** `lsof -ti :3000 -ti :3001 | xargs kill -9`
- **Windows:** Use the PowerShell or Command Prompt commands from the cleanup section

#### Server Not Starting
- Verify the path to `server.js` is correct and absolute
- Check that `node` command is in your PATH, or use full path to node executable
- Check Claude Desktop logs: `~/Library/Logs/Claude/mcp-server-3d-model-server.log` (macOS)

#### Tools Not Appearing
- Check Claude Desktop logs for errors
- Verify the server started successfully
- Restart Claude Desktop completely

#### Local App Not Connecting (Default Setup)
- Verify your local 3D app is running (`npm run dev`)
- Check that the app is accessible at `http://localhost:5173`
- Verify `.env` file has `BROWSER_URL=http://localhost:5173` (this is the default)
- Check browser console for WebSocket connection errors
- Ensure WebSocket server is running on port 3001 (Claude Desktop starts it automatically)

#### Netlify App Not Connecting (Optional Setup)
- Verify WebSocket tunnel is running (`lt --port 3001 --subdomain hello3dllm-websocket`)
- Check `VITE_WS_URL` is set correctly in Netlify (use `wss://` protocol)
- Ensure tunnel URL matches what's configured in Netlify
- Verify `.env` file has `BROWSER_URL` set to your Netlify URL
- Check browser console for WebSocket connection errors
- Ensure Netlify site has been redeployed after setting `VITE_WS_URL`

---

## Option 2: HTTP/SSE Mode (For Remote/Tunneled Servers)

Use this mode if you want to run the server manually or connect via a tunnel.

### Step-by-Step Setup

1. **Clean up any existing processes:**
   - See [Clean Up Existing Processes](#clean-up-existing-processes-start-with-a-clean-slate) section below
   - Make sure ports 3000 and 3001 are free before starting

2. **Start your MCP server manually:**
   ```bash
   node server.js
   ```
   Server should be running on `http://localhost:3000/mcp`

3. **Create a tunnel for your MCP server (if connecting remotely):**

   **Option A: Using ngrok**
   ```bash
   ngrok http 3000
   ```
   Copy the HTTPS URL shown (e.g., `https://abc123.ngrok-free.app`)
   
   **Option B: Using localtunnel**
   ```bash
   lt --port 3000 --subdomain hello3dllm-mcpserver
   ```
   Creates URL: `https://hello3dllm-mcpserver.loca.lt`
   
   ⚠️ **Important:** Keep this tunnel running while using Claude Desktop!

4. **Locate Claude Desktop configuration file:**

   **macOS:**
   ```
   ~/Library/Application Support/Claude/claude_desktop_config.json
   ```
   
   **Windows:**
   ```
   %APPDATA%\Claude\claude_desktop_config.json
   ```
   
   **Linux:**
   ```
   ~/.config/Claude/claude_desktop_config.json
   ```

5. **Edit the configuration file:**

   If the file doesn't exist, create it. Add or update the `mcpServers` section:
   
   **For ngrok:**
   ```json
   {
     "mcpServers": {
       "3d-model-server": {
         "url": "https://abc123.ngrok-free.app/mcp",
         "transport": "sse"
       }
     }
   }
   ```
   
   **For localtunnel:**
   ```json
   {
     "mcpServers": {
       "3d-model-server": {
         "url": "https://hello3dllm-mcpserver.loca.lt/mcp",
         "transport": "sse"
       }
     }
   }
   ```
   
   ⚠️ **Important Notes:**
   - **Endpoint:** Use `/mcp` (NOT `/sse`) - your server handles SSE streams on `/mcp`
   - **Transport:** Use `"transport": "sse"` (Server-Sent Events) - this matches your server's `StreamableHTTPServerTransport`
   - The endpoint `/mcp` handles both POST requests (initialization/tool calls) and GET requests (SSE streams)
   - Claude Desktop's example shows `/sse`, but that's just a generic example - your server uses `/mcp`
   
   ⚠️ **Important:** 
   - Replace the URL with your actual tunnel URL
   - **Include `/mcp` at the end** of the URL
   - Use `https://` (not `http://`) for the tunnel URL

6. **Restart Claude Desktop:**
   - Quit Claude Desktop completely
   - Reopen Claude Desktop
   - The MCP server should now be connected

7. **Verify the connection:**
   - In Claude Desktop, ask: "What tools do you have available?"
   - Claude should list your MCP tools (e.g., `change_model_color`, `change_model_size`, etc.)
   - If tools aren't showing, check:
     - Tunnel is still running
     - Configuration file has correct URL with `/mcp` suffix
     - Claude Desktop was fully restarted

8. **Start your local 3D app:**
   ```bash
   npm run dev
   ```
   This starts the development server on `http://localhost:5173`
   - The `.env` file (created automatically) defaults to `BROWSER_URL=http://localhost:5173`
   - No additional configuration needed for localhost setup

9. **Connect to the 3D app:**
   - Ask Claude Desktop: "How do I connect to the 3D app?" or "Get browser URL"
   - Claude will provide a localhost URL with your unique session ID (e.g., `http://localhost:5173?sessionId=<unique-uuid>`)
   - Copy and paste the URL into your browser
   - The browser will connect to your Claude Desktop session
   - **Note:** Each Claude Desktop process gets its own unique UUID session ID, ensuring proper session isolation

**Default Configuration:**
- The `.env` file defaults to `BROWSER_URL=http://localhost:5173`
- No WebSocket tunnel needed for localhost (browser connects directly to `ws://localhost:3001`)
- Simple setup - just run `npm run dev` and connect!

**Note:** If you prefer to use Netlify instead, see the [Using Netlify Instead of Localhost](#using-netlify-instead-of-localhost-optionaladvanced) section below.

---

### Troubleshooting HTTP/SSE Mode

#### Tools Not Appearing
- Verify tunnel is running (`ngrok http 3000` or `lt --port 3000`)
- Check configuration file JSON syntax is valid
- Ensure URL includes `/mcp` at the end
- Restart Claude Desktop completely

#### Connection Errors
- Verify MCP server is running (`node server.js`)
- Check tunnel URL is accessible in browser: `https://your-tunnel-url/mcp`
- Ensure tunnel hasn't expired (ngrok free tier URLs change on restart)

#### Changes Not Visible
- If using localhost (default): Make sure your 3D app is running (`npm run dev`)
- If using Netlify (optional): Verify WebSocket tunnel is running and Netlify has correct `VITE_WS_URL` configured
- Verify browser is connected to the correct session
- Check browser console for WebSocket connection errors

---

## Clean Up Existing Processes (Start with a Clean Slate)

Before setting up Claude Desktop, it's important to ensure ports 3000 and 3001 are free. These ports are commonly used and may already be occupied by previous server instances or other applications.

### Check for Processes on Ports 3000 and 3001

**macOS/Linux:**
```bash
# Check what's using port 3000
lsof -i :3000

# Check what's using port 3001
lsof -i :3001

# Check both ports at once
lsof -i :3000 -i :3001
```

**Windows (PowerShell):**
```powershell
# Check what's using port 3000
netstat -ano | findstr :3000

# Check what's using port 3001
netstat -ano | findstr :3001
```

**Windows (Command Prompt):**
```cmd
netstat -ano | findstr :3000
netstat -ano | findstr :3001
```

### Kill Processes on Ports 3000 and 3001

**macOS/Linux:**
```bash
# Kill processes on both ports (recommended)
lsof -ti :3000 -ti :3001 | xargs kill -9

# Or kill them individually
# First, find the PID (Process ID) from lsof output, then:
kill -9 <PID>

# Alternative: Kill all node processes (use with caution)
pkill -f "node.*server.js"
```

**Windows (PowerShell):**
```powershell
# Find and kill process on port 3000
$port3000 = netstat -ano | findstr :3000 | Select-String "\s+(\d+)$" | ForEach-Object { $_.Matches.Groups[1].Value } | Select-Object -First 1
if ($port3000) { taskkill /PID $port3000 /F }

# Find and kill process on port 3001
$port3001 = netstat -ano | findstr :3001 | Select-String "\s+(\d+)$" | ForEach-Object { $_.Matches.Groups[1].Value } | Select-Object -First 1
if ($port3001) { taskkill /PID $port3001 /F }
```

**Windows (Command Prompt):**
```cmd
# Find the PID from netstat output, then:
taskkill /PID <PID> /F

# Or kill all node processes (use with caution)
taskkill /IM node.exe /F
```

### Verify Ports are Free

After killing processes, verify the ports are free:

**macOS/Linux:**
```bash
# Should return nothing if ports are free
lsof -i :3000 -i :3001
```

**Windows:**
```cmd
# Should return nothing if ports are free
netstat -ano | findstr ":3000 :3001"
```

---

## Using the MCP Tools

Once connected, ask Claude Desktop to manipulate the model using natural language:

- **Change color**: "Change the model to red" or "Make it blue"
- **Change size**: "Make the model bigger" or "Set size to 2.5"
- **Scale**: "Stretch horizontally" or "Make it tall and thin"
- **Background**: "Change background to black"
- **Combined**: "Make a red model that's tall and thin"

Claude will automatically call the appropriate MCP tools, and changes appear in real-time in your browser.

---

## Recommendation

For Claude Desktop, use **Subprocess Mode** (Option 1) - it's the simplest setup as Claude Desktop manages the server automatically.

**Default Behavior:** The setup defaults to using localhost (`http://localhost:5173`), which is the simplest configuration. Just run `npm run dev` and connect - no tunneling required!

**Using Netlify:** If you prefer to use a Netlify-hosted app, you can override the default by setting `BROWSER_URL=https://your-app.netlify.app` in your `.env` file and setting up a WebSocket tunnel. See [Using Netlify Instead of Localhost](#using-netlify-instead-of-localhost-optionaladvanced) for details.

---

## Next Steps

- See the main [README.md](../README.md) for more information about available MCP tools
- Check [CHATGPT_SETUP.md](./CHATGPT_SETUP.md) for ChatGPT setup (requires tunneling)
- Review the project structure and architecture in the main README


