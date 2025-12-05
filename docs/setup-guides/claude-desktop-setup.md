# Claude Desktop Setup Guide

Claude Desktop is Anthropic's free desktop application that supports MCP servers. This guide covers setting up the Hello3DMCP server with Claude Desktop using the MCP package (`.mcpb`) file.

## Prerequisites

- Node.js (v18 or higher)
- npm
- Claude Desktop installed (download from https://claude.ai/download)

## Installation

### Step 1: Build the Package

Build the MCP package file:

```bash
npm run build
```

This creates `hello3dmcp-server.mcpb` in your project root.

### Step 2: Install in Claude Desktop

1. **Open Claude Desktop**
2. **Go to Settings** → **Extensions** → **Advanced Settings**
3. **Click "Install Extension"** button
4. **Select the `hello3dmcp-server.mcpb` file**
5. **Restart Claude Desktop** (quit completely and reopen)

Claude Desktop will automatically extract and configure the server.

### Step 3: Verify the Connection

1. **In Claude Desktop, ask:** "What tools do you have available?"
2. **Claude should list your MCP tools** (e.g., `change_model_color`, `change_model_size`, etc.)

### Step 4: Connect to the 3D App

1. **Ask Claude Desktop:** "How do I connect to the 3D app?" or "Get browser URL"
2. **Claude will provide a URL** with your unique session ID
3. **Open that URL in your browser**

The 3D app runs in your browser and communicates directly with Claude Desktop via standard IO.

## Troubleshooting

### Package Not Installing

- Verify the `.mcpb` file was created successfully (`npm run build`)
- Check that Claude Desktop is up to date (supports `.mcpb` packages)
- Try restarting Claude Desktop

### Server Not Starting

- Check Claude Desktop logs: `~/Library/Logs/Claude/mcp-server-hello3dmcp-server.log` (macOS)
- Verify ports 3000 and 3001 are available
- Check that Node.js is installed (required to run the bundled server)

### Tools Not Appearing

- Restart Claude Desktop completely
- Verify the package installed successfully in Settings → Extensions
- Check logs for errors

## Using the MCP Tools

Once connected, ask Claude Desktop to manipulate the model using natural language:

- **Change color**: "Change the model to red" or "Make it blue"
- **Change size**: "Make the model bigger" or "Set size to 2.5"
- **Scale**: "Stretch horizontally" or "Make it tall and thin"
- **Background**: "Change background to black"
- **Combined**: "Make a red model that's tall and thin"

Claude will automatically call the appropriate MCP tools, and changes appear in real-time in your browser.

## Next Steps

- See the main [README.md](../../README.md) for more information about available MCP tools
- Check [chatgpt-setup.md](./chatgpt-setup.md) for ChatGPT setup (requires tunneling)
- Review the project structure and architecture in the main README
