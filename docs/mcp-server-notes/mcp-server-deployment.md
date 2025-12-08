# MCP Server Remote Deployment Options

## Overview

This document describes two approaches for deploying an MCP server to a client's office environment while maintaining compatibility with Claude Desktop's stdio-based communication model.

**Current Setup:**
- MCP server running locally on development machine
- Claude Desktop communicating via stdio (standard input/output)
- 3D application accessible via browser

**Goal:**
- Host MCP server at client's office
- Allow multiple users to access the server
- Maintain compatibility with Claude Desktop

---

## Option 2: SSH Tunneling

### Concept

Use SSH to tunnel the stdio communication from Claude Desktop on each user's machine to a centralized MCP server running on an office server. The MCP server code remains unchanged and continues to use stdio, but the communication happens over an SSH connection.

### Architecture

```
[User's Machine]                    [Office Server]
┌─────────────────┐                ┌──────────────────┐
│ Claude Desktop  │                │                  │
│       ↕         │                │                  │
│     stdio       │   SSH tunnel   │   MCP Server     │
│       ↕         │ ←─────────────→│   (Node.js)      │
│   SSH Client    │                │                  │
└─────────────────┘                └──────────────────┘
                                            ↕
                                   [3D App - hosted anywhere]
```

### Implementation Steps

#### 1. Server Setup (Office Server)

**Install Dependencies:**
- Node.js runtime
- Your MCP server code
- SSH server (usually pre-installed on Linux/Mac)

**Configure SSH:**
- Create a dedicated service account for MCP access
- Set up user home directory with MCP server code
- Configure SSH to allow key-based authentication
- Optionally restrict the account to only run the MCP server (forced command)

**Deploy MCP Server:**
```bash
# On office server
/opt/mcp-server/
  ├── server.js (your MCP server)
  ├── package.json
  ├── node_modules/
  └── config/
```

#### 2. User Machine Setup

**Generate SSH Keys:**
```bash
# On each user's machine
ssh-keygen -t ed25519 -f ~/.ssh/mcp_key
```

**Copy Public Key to Server:**
```bash
ssh-copy-id -i ~/.ssh/mcp_key.pub mcp-user@office-server.company.com
```

**Configure Claude Desktop:**

Edit Claude Desktop's MCP configuration file:
```json
{
  "mcpServers": {
    "3d-model-server": {
      "command": "ssh",
      "args": [
        "-i", "/Users/username/.ssh/mcp_key",
        "mcp-user@office-server.company.com",
        "node", "/opt/mcp-server/server.js"
      ]
    }
  }
}
```

#### 3. Security Considerations

- Use SSH key authentication (no passwords)
- Consider using SSH certificates for easier management
- Implement SSH connection limits per user
- Monitor SSH logs for suspicious activity
- Use firewall rules to restrict SSH access to known IPs
- Consider using a VPN if users work remotely

#### 4. Maintenance

**Updates:**
- Update server code on the central server
- All users automatically use the new version on next connection

**Monitoring:**
- Each user connection spawns a new server process
- Monitor server resources (CPU, memory, process count)
- Set up logging to track usage and errors

### Pros and Cons

**Advantages:**
- Simple implementation - mostly configuration
- No custom code required
- Secure by default (SSH encryption)
- MCP server code remains unchanged
- Standard tooling and debugging

**Disadvantages:**
- Each user spawns separate server process (not truly centralized)
- Requires SSH infrastructure and key management
- May face corporate firewall restrictions
- Need to manage SSH access for each user

---

## Option 3: Network Proxy with Remote Server

### Concept

Create a lightweight local proxy that maintains stdio communication with Claude Desktop while forwarding requests over HTTP/WebSocket to a centralized MCP server. This allows true multi-user centralization with one server instance serving all users.

### Architecture

```
[User Machine A]              [Office Server]              [3D App Host]
┌──────────────┐             ┌─────────────────┐          ┌──────────┐
│Claude Desktop│             │  MCP Server     │          │  3D App  │
│      ↕       │             │  (HTTP/WS)      │          │  (Web)   │
│    stdio     │             │                 │←────────→│          │
│      ↕       │  HTTP/WS    │  - Auth         │ WebSocket└──────────┘
│ Local Proxy  │←───────────→│  - Routing      │
└──────────────┘             │  - State Mgmt   │
                             └─────────────────┘
[User Machine B]                      ↑
┌──────────────┐                      │
│Claude Desktop│                      │
│      ↕       │      HTTP/WS         │
│ Local Proxy  │──────────────────────┘
└──────────────┘
```

### Implementation Steps

#### 1. Remote MCP Server (Office Server)

**Refactor Server to Use HTTP/WebSocket:**

Create a network-enabled MCP server that:
- Accepts WebSocket connections from proxies
- Implements JSON-RPC over WebSocket
- Handles authentication and session management
- Maintains state for multiple concurrent users
- Communicates with 3D app instances

**Example Structure:**
```javascript
// server.js
const WebSocket = require('ws');
const express = require('express');

const app = express();
const wss = new WebSocket.Server({ port: 8080 });

// Session management
const sessions = new Map();

wss.on('connection', (ws, req) => {
  const sessionId = authenticateConnection(req);
  sessions.set(sessionId, ws);
  
  ws.on('message', async (message) => {
    const request = JSON.parse(message);
    const response = await handleMCPRequest(request, sessionId);
    ws.send(JSON.stringify(response));
  });
  
  ws.on('close', () => {
    sessions.delete(sessionId);
  });
});
```

**Features to Implement:**
- Authentication (API keys, OAuth, etc.)
- User session management
- Request routing to correct 3D app instances
- Error handling and logging
- Rate limiting
- Health monitoring

#### 2. Local Proxy (User Machines)

**Create Lightweight Proxy Script:**

This proxy bridges stdio (for Claude Desktop) and WebSocket (for remote server):

```javascript
// proxy.js
const WebSocket = require('ws');
const readline = require('readline');

const WS_URL = 'wss://office-server.company.com:8080';
const API_KEY = process.env.MCP_API_KEY;

const ws = new WebSocket(WS_URL, {
  headers: { 'Authorization': `Bearer ${API_KEY}` }
});

// Read from stdin (Claude Desktop)
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  // Forward JSON-RPC request to remote server
  ws.send(line);
});

// Receive from remote server
ws.on('message', (data) => {
  // Forward JSON-RPC response to Claude Desktop
  console.log(data.toString());
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
  process.exit(1);
});
```

**Deploy Proxy:**
- Package proxy as a simple npm package or standalone script
- Distribute to user machines
- Configure with server URL and credentials

#### 3. Claude Desktop Configuration

**Configure MCP Settings:**
```json
{
  "mcpServers": {
    "3d-model-server": {
      "command": "node",
      "args": ["/path/to/proxy.js"],
      "env": {
        "MCP_API_KEY": "user-specific-api-key"
      }
    }
  }
}
```

#### 4. Security Implementation

**Authentication Options:**
- API keys (simple, user-specific)
- OAuth 2.0 (enterprise-grade)
- Client certificates
- Session tokens

**Transport Security:**
- Use WSS (WebSocket Secure) with TLS/SSL
- Validate certificates
- Implement request signing if needed

**Example Auth Flow:**
```javascript
// In proxy.js
const ws = new WebSocket(WS_URL, {
  headers: { 
    'Authorization': `Bearer ${API_KEY}`,
    'X-User-ID': process.env.USER_ID
  }
});

// In server.js
function authenticateConnection(req) {
  const token = req.headers['authorization']?.split(' ')[1];
  const userId = req.headers['x-user-id'];
  
  if (!validateToken(token, userId)) {
    throw new Error('Authentication failed');
  }
  
  return createSession(userId);
}
```

#### 5. 3D App Integration

**Connect MCP Server to 3D Apps:**

The remote MCP server needs to route commands to the correct 3D app instance:

```javascript
// In server.js
async function handleMCPRequest(request, sessionId) {
  const session = sessions.get(sessionId);
  
  // Route to user's 3D app instance
  const appConnection = await get3DAppConnection(session.userId);
  const result = await appConnection.sendCommand(request.params);
  
  return {
    jsonrpc: "2.0",
    id: request.id,
    result: result
  };
}
```

**3D App Connection Options:**
- WebSocket connection per user
- Shared WebSocket with routing by session ID
- HTTP REST API calls
- Message queue (Redis Pub/Sub, etc.)

#### 6. Deployment and Monitoring

**Server Deployment:**
- Deploy to office server or cloud instance
- Use process manager (PM2, systemd)
- Set up reverse proxy (nginx, Apache) for HTTPS
- Configure firewall rules

**Monitoring:**
- Track active connections
- Log all requests and errors
- Monitor server resources
- Set up alerts for failures

**Example Monitoring:**
```javascript
// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeConnections: sessions.size,
    uptime: process.uptime()
  });
});
```

### Pros and Cons

**Advantages:**
- True centralization - one server instance for all users
- Fine-grained control over authentication, logging, monitoring
- Can use standard HTTPS ports (firewall-friendly)
- Easier to add features like caching, rate limiting
- Can implement sophisticated routing and state management

**Disadvantages:**
- Requires custom development (proxy + network server)
- More complex architecture with more potential failure points
- Need to implement and maintain security layer
- Still requires deploying proxy to each user machine
- More testing and debugging required

---

## Comparison Matrix

| Factor | SSH Tunneling | Network Proxy |
|--------|---------------|---------------|
| **Setup Complexity** | Low | Medium-High |
| **Development Effort** | Minimal | Significant |
| **True Centralization** | No (process per user) | Yes (single instance) |
| **Security** | SSH built-in | Must implement |
| **Firewall Friendliness** | Medium (SSH port) | High (HTTPS) |
| **Code Changes** | None | Substantial |
| **Scalability** | Limited | High |
| **Maintenance** | Low | Medium |
| **User Management** | SSH keys | Custom auth |
| **Debugging** | Easy | Moderate |

---

## Recommendations

### Choose SSH Tunneling If:
- You need a solution quickly (days not weeks)
- User count is small (<10 users)
- SSH access is acceptable in the environment
- You don't need shared state between users
- Development resources are limited

### Choose Network Proxy If:
- You need true multi-user centralization
- Corporate policies restrict SSH
- You want advanced features (analytics, caching, etc.)
- You expect significant growth in users
- You have development resources for custom implementation
- You need fine-grained access control

### Hybrid Approach:
Start with SSH tunneling for rapid deployment, then migrate to network proxy as needs grow. This allows you to:
- Deliver value quickly to the client
- Learn about usage patterns
- Build the network solution with real requirements
- Minimize initial risk and complexity