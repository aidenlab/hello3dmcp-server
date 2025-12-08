# Transition from Single User to Multi User Architecture

## Overview

This document describes the transition from a single-user broadcast architecture to a multi-user session-based routing system that provides full isolation between concurrent ChatGPT sessions.

## Problem Statement

### Original Architecture (Single User)
- **WebSocket Storage**: Used a `Set` to store all connected browser clients
- **Command Routing**: All MCP tool commands were broadcast to ALL connected browsers
- **Issue**: Multiple ChatGPT users would interfere with each other
  - User A changes color → ALL browsers see the change
  - User B changes size → ALL browsers see the change
  - No isolation between sessions
  - Race conditions when multiple users act simultaneously

### Requirements for Multi-User Support
- Each ChatGPT session should control only its own browser client
- Multiple users should be able to use the system simultaneously without interference
- Predictable behavior: commands route to the correct browser
- Scalable: O(1) routing per session instead of O(n) broadcasts

## Solution: Session-Based Routing

### Architecture Overview

The solution implements **session-based routing** using URL-based session pairing:

1. **MCP Layer** (ChatGPT ↔ Server): Each ChatGPT client gets its own session ID and transport (already isolated)
2. **WebSocket Layer** (Server ↔ Browser): Browser clients register with a session ID, commands route to specific sessions

### Key Components

#### 1. Server-Side Changes (`server.js`)

**WebSocket Storage**
- Changed from `Set<WebSocket>` to `Map<sessionId, WebSocket>`
- Enables lookup of browser client by session ID

**Session Registration**
- Browser clients send `registerSession` message with their session ID on WebSocket connection
- Server stores the mapping: `wsClients.set(sessionId, ws)`
- Server sends confirmation: `sessionRegistered` message

**Routing Functions**
- `sendToSession(sessionId, command)`: Routes command to specific session's browser
- `routeToCurrentSession(command)`: Helper for tool handlers to route to current request's session
- `broadcastToClients(command)`: Kept for backward compatibility (no longer used)

**Request Context**
- `sessionContext`: AsyncLocalStorage-based context that maintains session ID across async operations
- `getCurrentSessionId()`: Helper function that works in both HTTP and STDIO modes
- In HTTP mode: Uses `sessionContext.getStore()` from AsyncLocalStorage
- In STDIO mode: Uses global `STDIO_SESSION_ID` (unique UUID per process)
- Allows tool handlers to access the session ID without modifying their signatures
- Context is maintained automatically by AsyncLocalStorage across async operations

**Tool Handler Updates**
- All 13 tool handlers updated to use `routeToCurrentSession()` instead of `broadcastToClients()`
- Commands now route only to the browser associated with the calling session

**POST Handler Updates**
- Uses `sessionContext.run(sessionId, async () => {...})` to set context before handling request
- Routes tool call notifications to specific session
- Context is automatically maintained by AsyncLocalStorage across all async operations
- Works seamlessly in both HTTP and STDIO modes

#### 2. Client-Side Changes (`src/WebSocketClient.js`)

**Session ID Support**
- Constructor accepts optional `sessionId` parameter
- Stores session ID in instance: `this.sessionId = sessionId`

**Connection Flow**
- On WebSocket `onopen`: Sends `registerSession` message with session ID
- On `onmessage`: Handles `sessionRegistered` confirmation and error messages
- Logs registration status for debugging

#### 3. Application Changes (`src/Application.js`)

**URL Parameter Extraction**
- Extracts `sessionId` from URL query parameters: `?sessionId=<uuid>`
- Uses `URLSearchParams` API: `new URLSearchParams(window.location.search)`

**Error Handling**
- Shows user-friendly error message if session ID is missing
- Prevents WebSocket connection if no session ID provided

**Session ID Passing**
- Passes extracted session ID to `WebSocketClient` constructor

## Implementation Details

### Session Registration Flow

```
1. Browser loads with ?sessionId=abc-123
2. Application extracts sessionId from URL
3. WebSocketClient connects to server
4. On connection open, sends: { type: 'registerSession', sessionId: 'abc-123' }
5. Server stores: wsClients.set('abc-123', ws)
6. Server responds: { type: 'sessionRegistered', sessionId: 'abc-123' }
7. Browser is now registered and ready to receive commands
```

### Command Routing Flow

**HTTP Mode:**
```
1. ChatGPT calls tool via MCP (session: abc-123)
2. POST handler receives request with mcp-session-id header
3. sessionContext.run(sessionId, async () => {...}) sets context
4. Tool handler executes, calls routeToCurrentSession(command)
5. routeToCurrentSession calls getCurrentSessionId() → gets from sessionContext
6. sendToSession('abc-123', command) looks up wsClients.get('abc-123') and sends command
7. Only browser with sessionId='abc-123' receives the command
8. Context automatically maintained by AsyncLocalStorage across async operations
```

**STDIO Mode:**
```
1. Claude Desktop calls tool via MCP (subprocess mode)
2. Server generates unique STDIO_SESSION_ID on startup (UUID)
3. Tool handler executes, calls routeToCurrentSession(command)
4. routeToCurrentSession calls getCurrentSessionId() → gets STDIO_SESSION_ID
5. sendToSession(STDIO_SESSION_ID, command) routes to browser with matching session ID
6. Only browser with matching sessionId receives the command
```

### Edge Cases Handled

1. **Missing Session ID in URL**
   - Application shows error message
   - WebSocket connection not attempted
   - User must include `?sessionId=<uuid>` in URL

2. **WebSocket Disconnect**
   - Server removes session from `wsClients` Map on `close` event
   - Logs disconnection with session ID

3. **MCP Session Without Browser**
   - Tool calls succeed (return response to ChatGPT)
   - Warning logged: "No active WebSocket connection found for session"
   - No crash or error - graceful degradation

4. **Browser Without MCP Session**
   - Browser connects and registers session ID
   - Waits for MCP session to connect
   - Once MCP session connects with matching ID, commands start routing

5. **Concurrent Requests**
   - AsyncLocalStorage ensures each request has correct session ID
   - Context is automatically isolated per async execution context
   - No cross-contamination between concurrent requests
   - Works seamlessly with async/await patterns

6. **STDIO Mode Support**
   - Each Claude Desktop process gets unique STDIO_SESSION_ID
   - Browser connects with matching session ID from URL
   - Commands route correctly even without HTTP request context
   - Full session isolation maintained in subprocess mode

## Files Modified

1. **server.js**
   - WebSocket storage: Set → Map
   - Connection handler: Session registration
   - Routing functions: `sendToSession()`, `routeToCurrentSession()`
   - All tool handlers: Use `routeToCurrentSession()`
   - POST handler: Context management and routing

2. **src/WebSocketClient.js**
   - Constructor: Accepts `sessionId` parameter
   - `onopen`: Sends registration message
   - `onmessage`: Handles registration confirmation

3. **src/Application.js**
   - `_setupWebSocket()`: Extracts sessionId from URL
   - Error handling: Missing sessionId
   - Passes sessionId to WebSocketClient

## Usage Instructions

### For ChatGPT Users

1. **Add MCP Tool**: Add Hello3DLLM as an MCP tool in ChatGPT

2. **Get Connection URL**: Ask ChatGPT: "How do I connect to the 3D app?" or "Get browser URL"
   - ChatGPT will call the `get_browser_connection_url` tool
   - Returns a URL with your session ID embedded: `https://your-app.netlify.app?sessionId=abc-123...`

3. **Open Browser**: Copy and paste the URL into your browser

4. **Browser Connects**: Browser automatically registers with server using session ID

5. **Isolated Control**: Your tool calls only affect your browser instance

### For Server Administrators

**Browser URL Configuration:**

The server needs to know which URL to provide in connection links. Configure it using one of these methods:

1. **Command-line argument** (recommended for testing):
   ```bash
   npm run mcp:server -- --browser-url https://your-app.netlify.app
   # or short form:
   npm run mcp:server -- -u https://your-app.netlify.app
   ```

2. **Environment variable**:
   ```bash
   BROWSER_URL=https://your-app.netlify.app npm run mcp:server
   ```

3. **Default** (if neither provided):
   - Uses `http://localhost:5173` for local development

**Priority Order:**
- Command-line argument (`--browser-url`) - highest priority
- Environment variable (`BROWSER_URL`)
- Default (`http://localhost:5173`) - lowest priority

### For Developers

**Testing Multi-User Scenario**:
1. Start server: `npm run mcp:server`
2. Open two browser windows:
   - Window 1: `http://localhost:5173?sessionId=session-1`
   - Window 2: `http://localhost:5173?sessionId=session-2`
3. Connect two ChatGPT sessions (each with different session IDs)
4. Verify isolation: Commands from session-1 only affect window 1, etc.

**Session ID Format**:
- UUID format (matches MCP session ID format)
- Example: `550e8400-e29b-41d4-a716-446655440000`
- Case-sensitive (should match exactly)

## Benefits

1. **Full Isolation**: Each ChatGPT session controls only its own browser
2. **Predictable Behavior**: Commands always route to correct browser
3. **Scalability**: O(1) routing per session instead of O(n) broadcasts
4. **No Race Conditions**: Session-based routing eliminates timing issues
5. **Better Debugging**: Can trace which session performed which action
6. **Privacy**: Users don't see each other's changes

## Technical Notes

### Why AsyncLocalStorage?

Tool handlers are registered with the MCP server and don't have direct access to the HTTP request context. Using `AsyncLocalStorage` allows tool handlers to access the session ID without:
- Modifying tool handler signatures
- Passing context through multiple layers
- Manual cleanup (AsyncLocalStorage handles it automatically)
- Works seamlessly with async/await patterns

The context is set using `sessionContext.run(sessionId, async () => {...})` which automatically maintains the session ID across all async operations within that execution context. This works in both HTTP mode (per request) and STDIO mode (per process).

### Why URL-Based Pairing?

URL-based pairing (Option A) was chosen because:
- **Simplicity**: No complex handshake protocol needed
- **User-Friendly**: ChatGPT user can easily share the URL
- **Flexible**: Browser can connect before or after MCP session
- **No State**: Server doesn't need to track pending connections

Alternative approaches considered:
- **Option B (Handshake-based)**: Server assigns session ID, browser displays it
- **Option C (Hybrid)**: URL if provided, otherwise server assigns

## Future Enhancements

Potential improvements for future consideration:

1. **Session ID Validation**: Validate UUID format on registration
2. **Session Expiration**: Auto-cleanup of stale sessions
3. **Session Management UI**: Display active sessions in admin panel
4. **Session Reconnection**: Handle browser refresh/reconnection gracefully
5. **Multiple Browsers Per Session**: Support multiple browsers for same session (collaboration mode)

## Migration Notes

### Breaking Changes

- **Required URL Parameter**: Browser URLs must now include `?sessionId=<uuid>`
- **No More Broadcasting**: Commands no longer broadcast to all clients by default

### Backward Compatibility

- `broadcastToClients()` function kept for potential future use
- Can be re-enabled if needed for specific use cases

## Conclusion

The transition from single-user to multi-user architecture provides:
- ✅ Full session isolation
- ✅ Concurrent user support
- ✅ Predictable command routing
- ✅ Scalable architecture
- ✅ Clean error handling

The implementation is complete and ready for production use with multiple concurrent ChatGPT sessions.

