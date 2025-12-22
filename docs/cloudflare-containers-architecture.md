# Cloudflare Containers Architecture: Communication Flow Explained

This document explains the architecture of `hello3dmcp-server` when deployed to Cloudflare Containers, including all communication flows, ports, and why certain issues occur.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Server Components](#server-components)
3. [Two Modes of Operation](#two-modes-of-operation)
4. [Communication Flows](#communication-flows)
5. [Port Usage](#port-usage)
6. [Cloudflare-Specific Setup](#cloudflare-specific-setup)
7. [The WebSocket Conflict Issue](#the-websocket-conflict-issue)
8. [Troubleshooting Guide](#troubleshooting-guide)

---

## Architecture Overview

Your `server.js` file contains **three main components** that work together:

1. **Express** - A web framework that handles HTTP requests
2. **HTTP Server** - Node.js's built-in HTTP server that listens on a port
3. **WebSocket Server** - Handles WebSocket connections for real-time communication

These components can run in different configurations depending on how the server is started.

---

## Server Components

### 1. Express (HTTP Request Handler)

**What it is:**
- A Node.js web framework for handling HTTP requests
- Routes HTTP requests to appropriate handlers
- Can serve static files and handle API endpoints

**What it does:**
- Handles POST requests to `/mcp` (MCP protocol communication)
- Handles GET requests to `/mcp` (MCP protocol queries)
- Serves static files (if `dist/` folder exists)
- Provides middleware for CORS, JSON parsing, etc.

**When it runs:**
- ✅ **HTTP Mode** (Docker/Cloudflare) - Always runs
- ❌ **STDIO Mode** (Claude Desktop) - Does NOT run

### 2. HTTP Server (Port Listener)

**What it is:**
- Node.js's built-in `http.createServer()` 
- Wraps Express and listens on a network port
- Handles both HTTP requests and WebSocket upgrade requests

**What it does:**
- Listens on port 3000 (or configured port)
- Receives all incoming network requests
- Routes HTTP requests to Express
- Handles WebSocket upgrade requests (before Express sees them)

**When it runs:**
- ✅ **HTTP Mode** (Docker/Cloudflare) - Always runs
- ❌ **STDIO Mode** (Claude Desktop) - Does NOT run

### 3. WebSocket Server (Real-time Communication)

**What it is:**
- Uses the `ws` library to handle WebSocket connections
- Attached to the HTTP Server (shares the same port)
- Handles real-time bidirectional communication with the frontend

**What it does:**
- Listens for WebSocket upgrade requests at `/ws`
- Maintains persistent connections with frontend clients
- Routes commands from MCP tools to the frontend
- Receives state updates from the frontend

**When it runs:**
- ✅ **HTTP Mode** (Docker/Cloudflare) - Runs on port 3000 at `/ws`
- ✅ **STDIO Mode** (Claude Desktop) - Runs on port 3001 (separate port)

---

## Two Modes of Operation

The server detects which mode to use based on how it's started:

### Mode Detection

```javascript
// Server checks: Is stdin a TTY (terminal)?
// If NO → STDIO Mode (Claude Desktop runs it as subprocess)
// If YES → HTTP Mode (Manual start or Docker)

const isStdioMode = !forceHttpMode && !process.stdin.isTTY;
```

**Forcing HTTP Mode:**
- Set `FORCE_HTTP_MODE=true` environment variable (used in Docker)
- Set `MCP_TRANSPORT=http` environment variable

---

## Communication Flows

### Mode 1: STDIO Mode (Claude Desktop / MCPB)

**What Runs:**
- ✅ WebSocket Server (port 3001)
- ❌ Express (does NOT run)
- ❌ HTTP Server (does NOT run)

**Communication Diagram:**

```
┌─────────────────┐
│  Claude Desktop │
│   (MCP Client)  │
└─────────────────┘
        ↕
    stdin/stdout
    (no port!)
        ↕
┌─────────────────┐
│     Server      │
│                 │
│  WebSocket      │ ← Port 3001
│    Server       │
└─────────────────┘
        ↕
    WebSocket
    (ws://localhost:3001)
        ↕
┌─────────────────┐
│    Frontend     │
│  (3D Browser    │
│     App)        │
└─────────────────┘
```

**Who Talks to Whom:**

1. **Claude Desktop ↔ Server**
   - Protocol: STDIO (stdin/stdout)
   - No network port involved
   - Claude Desktop starts server as subprocess
   - Direct process communication

2. **Frontend ↔ Server**
   - Protocol: WebSocket
   - Port: 3001
   - URL: `ws://localhost:3001`
   - Real-time bidirectional communication

**Why No Conflicts:**
- Express doesn't run, so there's nothing to conflict with
- WebSocket runs on separate port (3001)
- Simple, clean separation

---

### Mode 2: HTTP Mode (Docker / Cloudflare)

**What Runs:**
- ✅ HTTP Server (port 3000)
- ✅ Express (attached to HTTP Server)
- ✅ WebSocket Server (attached to HTTP Server, same port 3000)

**Communication Diagram:**

```
┌─────────────────┐
│   MCP Client    │
│  (Inspector,    │
│   other tools)  │
└─────────────────┘
        ↕
    HTTP POST
    /mcp
    Port 3000
        ↕
┌─────────────────────────────────────┐
│    HTTP Server (Port 3000)          │
│                                      │
│  ┌──────────────────────────────┐   │
│  │        Express                │   │ ← Handles /mcp
│  │  (HTTP request handler)       │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │    WebSocket Server          │   │ ← Handles /ws
│  │  (attached to HTTP Server)   │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
        ↕
    WebSocket
    /ws
    Port 3000
        ↕
┌─────────────────┐
│    Frontend     │
│  (3D Browser    │
│     App)        │
└─────────────────┘
```

**Who Talks to Whom:**

1. **MCP Client ↔ Server**
   - Protocol: HTTP POST/GET
   - Port: 3000
   - Endpoint: `/mcp`
   - Express handles these requests

2. **Frontend ↔ Server**
   - Protocol: WebSocket
   - Port: 3000 (same as HTTP!)
   - Path: `/ws`
   - WebSocket Server handles these connections

**The Complexity:**
- Both HTTP and WebSocket share the same port (3000)
- Express handles HTTP requests
- WebSocket Server handles WebSocket upgrades
- They must not interfere with each other

---

## Port Usage

### STDIO Mode (Claude Desktop)

| Component | Port | Path | Protocol | Purpose |
|-----------|------|------|----------|---------|
| WebSocket Server | 3001 | (root) | WebSocket | Frontend communication |
| Claude Desktop | N/A | N/A | STDIO | MCP protocol |

### HTTP Mode (Docker/Cloudflare)

| Component | Port | Path | Protocol | Purpose |
|-----------|------|------|----------|---------|
| HTTP Server | 3000 | - | HTTP/WebSocket | Base server |
| Express | 3000 | `/mcp` | HTTP | MCP protocol |
| WebSocket Server | 3000 | `/ws` | WebSocket | Frontend communication |

**Important:** In HTTP mode, both HTTP and WebSocket use port 3000, differentiated by:
- HTTP requests → Express handles (e.g., `/mcp`)
- WebSocket upgrades → WebSocket Server handles (e.g., `/ws`)

---

## Cloudflare-Specific Setup

### Architecture with Cloudflare Worker Proxy

When deployed to Cloudflare, an additional layer is added:

```
┌─────────────────┐
│   MCP Client    │
│  (Inspector)    │
└─────────────────┘
        ↕
    HTTP POST
    /mcp
    Port 8787
        ↕
┌─────────────────────────────────────┐
│   Cloudflare Worker Proxy          │
│   (runs on port 8787 locally)       │
│   (index.js - forwards requests)    │
└─────────────────────────────────────┘
        ↕
    Forwards to
    Container
        ↕
┌─────────────────────────────────────┐
│   Container (Port 3000)             │
│                                      │
│  ┌──────────────────────────────┐   │
│  │        Express                │   │ ← Handles /mcp
│  └──────────────────────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │    WebSocket Server          │   │ ← Handles /ws
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
        ↕
    WebSocket
    /ws
    Port 3000
        ↕
┌─────────────────┐
│    Frontend     │
│  (connects to   │
│   port 8787)    │
└─────────────────┘
```

### Port Mapping in Cloudflare Setup

| Component | External Port | Internal Port | Path | Protocol |
|-----------|---------------|---------------|------|----------|
| Worker Proxy | 8787 | - | `/mcp` | HTTP |
| Worker Proxy | 8787 | - | `/ws` | WebSocket |
| Container | - | 3000 | `/mcp` | HTTP |
| Container | - | 3000 | `/ws` | WebSocket |

**Key Points:**
- Frontend connects to **port 8787** (Worker proxy)
- Worker forwards to container on **port 3000**
- Container handles both HTTP and WebSocket on the same port

---

## The WebSocket Conflict Issue

### The Problem

In HTTP mode, when a WebSocket connection request comes in:

1. **Request arrives:** `ws://localhost:3000/ws`
2. **HTTP Server receives it** (with `Upgrade: websocket` header)
3. **Express middleware runs FIRST** (before upgrade event fires)
4. **Express sees `/ws`** and tries to handle it as HTTP
5. **Express returns 404** (doesn't know how to handle WebSocket)
6. **WebSocket upgrade never happens** (Express already sent response)

### Why This Happens

Node.js HTTP server request flow:
```
HTTP Request → HTTP Server → Express Middleware → Express Routes → Response
```

WebSocket upgrade flow (what we need):
```
HTTP Request (with Upgrade header) → HTTP Server → 'upgrade' event → WebSocket Server
```

**The conflict:** Express middleware runs before the `upgrade` event fires.

### The Solution

Tell Express: "Don't touch `/ws` requests - let the HTTP server handle them."

**Code Fix:**
```javascript
app.use((req, res, next) => {
  // Skip WebSocket upgrade requests
  if (req.path === '/ws' || req.headers.upgrade === 'websocket') {
    return; // Don't process, let HTTP server handle upgrade
  }
  // ... handle other requests
});
```

This ensures:
- Express doesn't send a response for `/ws` requests
- HTTP server's `upgrade` event can fire
- WebSocket Server can handle the upgrade

---

## Troubleshooting Guide

### Issue: WebSocket Connection Fails (404 Error)

**Symptoms:**
- Frontend can't connect to WebSocket
- Server logs show: `GET /ws 404 Not Found`
- Response headers show `'x-powered-by': 'Express'`

**Cause:**
- Express is intercepting `/ws` requests before WebSocket upgrade happens

**Solution:**
- Ensure Express middleware skips `/ws` path (see code fix above)
- Rebuild Docker image
- Restart `wrangler dev`

### Issue: MCP Endpoint Not Working

**Symptoms:**
- MCP Inspector can't connect
- POST requests to `/mcp` return errors

**Cause:**
- Express not handling `/mcp` route correctly
- Container not running

**Solution:**
- Check Express routes are set up for `/mcp`
- Verify container is running: `docker ps`
- Check `wrangler dev` logs

### Issue: Frontend Can't Connect in Cloudflare Setup

**Symptoms:**
- Frontend connects to `ws://localhost:8787/ws` but fails
- Worker proxy logs show errors

**Cause:**
- Wrong port (should be 8787 for Worker, not 3000)
- Worker not forwarding WebSocket upgrades correctly

**Solution:**
- Verify frontend connects to port **8787** (Worker proxy)
- Check Worker code forwards requests correctly
- Ensure container is running and accessible

---

## Summary

### Key Takeaways

1. **Three Components:**
   - Express (HTTP handler)
   - HTTP Server (port listener)
   - WebSocket Server (real-time communication)

2. **Two Modes:**
   - **STDIO Mode:** Only WebSocket Server runs (port 3001)
   - **HTTP Mode:** All three run (port 3000)

3. **Cloudflare Adds:**
   - Worker proxy (port 8787) that forwards to container (port 3000)

4. **The Conflict:**
   - Express intercepts `/ws` before WebSocket upgrade happens
   - Solution: Make Express skip `/ws` requests

5. **Ports:**
   - **STDIO Mode:** WebSocket on 3001
   - **HTTP Mode:** HTTP + WebSocket on 3000
   - **Cloudflare:** Frontend connects to 8787, forwards to 3000

---

## Quick Reference

### For Claude Desktop (STDIO Mode)
- WebSocket: `ws://localhost:3001`
- No HTTP server
- No Express

### For Docker Direct (HTTP Mode)
- HTTP MCP: `http://localhost:3000/mcp`
- WebSocket: `ws://localhost:3000/ws`
- Express + HTTP Server + WebSocket Server all run

### For Cloudflare (HTTP Mode + Worker)
- HTTP MCP: `http://localhost:8787/mcp` (via Worker)
- WebSocket: `ws://localhost:8787/ws` (via Worker)
- Worker forwards to container on port 3000

---

**Document Version:** 1.0  
**Last Updated:** December 2025  
**Related Documents:** `cloudflare_container_deployment.md`

