# Bidirectional Communication Flow: Complete Round-Trip Analysis

This document traces the complete flow of bidirectional communication in the 3D model server, from requesting state in Claude/ChatGPT to manipulating that state and sending updates back. We'll use the example of requesting the model color, then darkening it.

## Overview: The Complete Round-Trip

The bidirectional communication system enables Claude/ChatGPT to:
1. **Query** the current state of the 3D application
2. **Use** that state information to make informed decisions
3. **Modify** the state based on the retrieved information
4. **Receive** automatic updates when state changes

The system uses a **hybrid approach** with caching for speed and optional force refresh for accuracy.

---

## Part 1: Requesting State (Query Flow)

### Step 1: User Request in Claude

**User says:** "What color is the model?"

**Claude's action:** Claude calls the `get_model_color` MCP tool.

### Step 2: MCP Tool Handler (server.js)

**Location:** `server.js` lines 1994-2044

```javascript
mcpServer.registerTool(
  'get_model_color',
  {
    title: 'Get Model Color',
    description: 'Get the current model color as a hex color code (e.g., "#ff0000")',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe('Force refresh from browser (defaults to false, uses cache)')
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return { content: [{ type: 'text', text: 'Error: No active session found.' }], isError: true };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const color = state.model?.color || '#808080';
      
      return {
        content: [{ 
          type: 'text', 
          text: formatStateResponse(color, 'Model color', sessionId, forceRefresh, metadata)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error retrieving model color: ${error.message}` }],
        isError: true
      };
    }
  }
);
```

**What happens:**
1. Tool handler receives the request with optional `forceRefresh` parameter (defaults to `false`)
2. Gets the current session ID using `getCurrentSessionId()` (handles both STDIO and HTTP modes)
3. Calls `getState(sessionId, forceRefresh)` to retrieve state
4. Extracts the model color from the state object
5. Returns formatted text response to Claude

### Step 3: State Retrieval Logic (server.js)

**Location:** `server.js` lines 328-378

```javascript
async function getState(sessionId, forceRefresh = false) {
  let state;
  let source;
  let wasCached = false;
  
  // If force refresh, always query browser
  if (forceRefresh) {
    try {
      state = await queryStateFromBrowser(sessionId, true);
      source = 'fresh';
    } catch (error) {
      // If force refresh fails, fall back to cache if available
      const cached = sessionStateCache.get(sessionId);
      if (cached) {
        console.warn(`Force refresh failed for session ${sessionId}, returning cached state: ${error.message}`);
        state = cached.state;
        source = 'cache';
        wasCached = true;
      } else {
        throw error;
      }
    }
  } else {
    // Otherwise, return cached state if available
    const cached = sessionStateCache.get(sessionId);
    if (cached) {
      state = cached.state;
      source = 'cache';
      wasCached = true;
    } else {
      // No cache, query browser
      try {
        state = await queryStateFromBrowser(sessionId, false);
        source = 'fresh';
      } catch (error) {
        throw new Error(`Unable to retrieve state: ${error.message}. Browser may be disconnected.`);
      }
    }
  }
  
  // Return state with metadata
  return {
    state,
    metadata: {
      source,
      wasCached,
      timestamp: new Date().toISOString()
    }
  };
}
```

**Decision Tree:**
- **If `forceRefresh = true`**: Always query browser (with cache fallback on error)
- **If cache exists**: Return cached state immediately (fast path, ~0ms)
- **If no cache**: Query browser for fresh state

**Key Point:** By default (`forceRefresh = false`), the system uses cached state for speed. This is the **hybrid approach** - fast by default, accurate when needed.

### Step 4: Query Browser (if cache miss or force refresh)

**Location:** `server.js` lines 309-325

```javascript
async function queryStateFromBrowser(sessionId, forceRefresh = false) {
  const requestId = generateRequestId();  // Generate unique UUID
  
  // Send request to browser
  const sent = sendToSession(sessionId, {
    type: 'requestState',
    requestId: requestId,
    forceRefresh: forceRefresh
  });
  
  if (!sent) {
    throw new Error('Browser not connected');
  }
  
  // Wait for response
  return await waitForStateResponse(requestId);
}
```

**What happens:**
1. Generates a unique `requestId` using UUID (for request-response correlation)
2. Sends WebSocket message `{ type: 'requestState', requestId: '...', forceRefresh: false }` to browser
3. Calls `waitForStateResponse(requestId)` which returns a Promise

### Step 5: Request-Response Correlation (server.js)

**Location:** `server.js` lines 293-306

```javascript
function waitForStateResponse(requestId, timeout = STATE_QUERY_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingStateQueries.delete(requestId);
      reject(new Error('State query timeout'));
    }, STATE_QUERY_TIMEOUT);  // Default: 2000ms
    
    pendingStateQueries.set(requestId, {
      resolve,
      reject,
      timeout: timeoutId
    });
  });
}
```

**What happens:**
1. Creates a Promise that will resolve when the response arrives
2. Stores the Promise's `resolve` and `reject` functions in `pendingStateQueries` Map, keyed by `requestId`
3. Sets a timeout (2 seconds) to reject if no response arrives
4. The Promise will be resolved/rejected when the browser sends a response (see Step 8)

**Data Structure:** `pendingStateQueries` Map
- **Key:** `requestId` (UUID string)
- **Value:** `{ resolve, reject, timeout }` object

### Step 6: WebSocket Message to Browser

**Location:** `server.js` lines 274-284

```javascript
function sendToSession(sessionId, command) {
  const ws = wsClients.get(sessionId);
  if (ws && ws.readyState === 1) { // WebSocket.OPEN
    const message = JSON.stringify(command);
    ws.send(message);
    return true;
  } else {
    console.warn(`No active WebSocket connection found for session: ${sessionId}`);
    return false;
  }
}
```

**Message sent:**
```json
{
  "type": "requestState",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "forceRefresh": false
}
```

### Step 7: Browser Receives Request (WebSocketClient.js)

**Location:** `src/WebSocketClient.js` lines 120-124

```javascript
// Handle state query requests
if (data.type === 'requestState' && data.requestId) {
  this._handleStateQuery(data.requestId, data.forceRefresh);
  return;
}
```

**Location:** `src/WebSocketClient.js` lines 249-266

```javascript
async _handleStateQuery(requestId, forceRefresh = false) {
  if (!this.onStateQuery) {
    // No state query handler, send error
    this._sendStateError(requestId, 'State query handler not available');
    return;
  }

  try {
    // Call the state query handler to get current state
    const state = await this.onStateQuery(forceRefresh);
    
    // Send state response back to server
    this._sendStateResponse(requestId, state);
  } catch (error) {
    console.error('Error retrieving state:', error);
    this._sendStateError(requestId, error.message || 'Failed to retrieve state');
  }
}
```

**What happens:**
1. WebSocketClient receives the `requestState` message
2. Calls `_handleStateQuery()` with the `requestId` and `forceRefresh` flag
3. Calls the `onStateQuery` callback (provided by Application.js) to retrieve state
4. Sends the state back to the server using `_sendStateResponse()`

### Step 8: Application Retrieves State (Application.js)

**Location:** `src/Application.js` lines 510-522

```javascript
this.wsClient = new WebSocketClient(
  // ... other callbacks ...
  (forceRefresh) => {
    // State query callback - return current scene state
    return this.getSceneState();
  }
);
```

**Location:** `src/Application.js` lines 643-668

```javascript
getSceneState() {
  return {
    model: {
      color: this.sceneManager.getModelColor(),
      scale: this.sceneManager.getModelScale(),
      rotation: this.sceneManager.getModelRotation()
    },
    background: this.sceneManager.getBackgroundColor(),
    keyLight: {
      intensity: this.sceneManager.getKeyLightIntensity(),
      color: this.sceneManager.getKeyLightColor(),
      position: this.sceneManager.getKeyLightPositionSpherical(),
      size: this.sceneManager.getKeyLightSize()
    },
    fillLight: {
      intensity: this.sceneManager.getFillLightIntensity(),
      color: this.sceneManager.getFillLightColor(),
      position: this.sceneManager.getFillLightPositionSpherical(),
      size: this.sceneManager.getFillLightSize()
    },
    camera: {
      distance: this.sceneManager.getCameraDistance(),
      fov: this.sceneManager.getCameraFOV()
    }
  };
}
```

**What happens:**
1. `getSceneState()` is called
2. It calls various getter methods on `SceneManager` to collect all state
3. Returns a comprehensive state object

**Location:** `src/SceneManager.js` lines 210-216

```javascript
getModelColor() {
  if (this.model) {
    const color = this.model.getMaterial().color;
    return '#' + color.getHexString().padStart(6, '0');
  }
  return '#808080'; // Default color
}
```

**What happens:**
1. Accesses the Three.js material's color object
2. Converts it to a hex string (e.g., `"#ff0000"`)
3. Returns the hex color code

### Step 9: Browser Sends State Response

**Location:** `src/WebSocketClient.js` lines 273-281

```javascript
_sendStateResponse(requestId, state) {
  if (this.isConnected()) {
    this.ws.send(JSON.stringify({
      type: 'stateResponse',
      requestId: requestId,
      state: state
    }));
  }
}
```

**Message sent:**
```json
{
  "type": "stateResponse",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "state": {
    "model": {
      "color": "#ff0000",
      "scale": { "x": 1.0, "y": 1.0, "z": 1.0 },
      "rotation": { "x": 0, "y": 0, "z": 0 }
    },
    "background": "#000000",
    "keyLight": { /* ... */ },
    "fillLight": { /* ... */ },
    "camera": { /* ... */ }
  }
}
```

### Step 10: Server Receives Response and Resolves Promise

**Location:** `server.js` lines 202-212

```javascript
// Handle state response messages
if (data.type === 'stateResponse' && data.requestId) {
  const query = pendingStateQueries.get(data.requestId);
  if (query) {
    clearTimeout(query.timeout);
    pendingStateQueries.delete(data.requestId);
    query.resolve(data.state);  // Resolve the Promise with the state
  } else {
    console.warn(`Received state response for unknown requestId: ${data.requestId}`);
  }
  return;
}
```

**What happens:**
1. Server receives `stateResponse` message
2. Looks up the Promise in `pendingStateQueries` using `requestId`
3. Clears the timeout
4. Removes the entry from `pendingStateQueries`
5. **Resolves the Promise** with the state data
6. This causes `waitForStateResponse()` to return, which causes `queryStateFromBrowser()` to return, which causes `getState()` to return

### Step 11: State Caching (Optional)

**Location:** `server.js` lines 214-222

```javascript
// Handle state update messages (push updates)
if (data.type === 'stateUpdate' && data.state) {
  sessionStateCache.set(sessionId, {
    state: data.state,
    timestamp: data.timestamp || Date.now()
  });
  console.warn(`State cache updated for session ${sessionId}`);
  return;
}
```

**Note:** State updates are typically pushed after commands (see Part 2), but if this is the first query, the state is returned directly without caching. However, if the browser sends a `stateUpdate` message, it will be cached.

**Data Structure:** `sessionStateCache` Map
- **Key:** `sessionId` (string)
- **Value:** `{ state: object, timestamp: number }`

### Step 12: Response to Claude

The `getState()` function returns the state object, the tool handler extracts `state.model.color`, and returns:

```
Model color: #ff0000
```

**Claude receives:** "Model color: #ff0000"

**How Claude "Stores" This Information:**
Claude doesn't store state in a separate data structure. Instead, the tool response `"Model color: #ff0000"` becomes part of the **conversation context** (the conversation history). When you later ask to "darken the color," Claude sees this previous message in the conversation history and uses that information. It's not retrieving from a database or variable - it's "remembering" by seeing the text in the conversation context.

**Important:** This only works within a single conversation. If you start a new conversation, Claude won't remember the previous color unless you query it again or enable Claude's Memory feature (which provides persistent memory across conversations).

---

## Part 2: Using State to Manipulate (Command Flow)

### Step 13: User Request to Darken Color

**User says:** "Darken the model color a bit"

**Claude's reasoning:**
1. Claude knows the current color is `#ff0000` (red)
2. To darken red, Claude needs to reduce the brightness
3. Claude calculates a darker shade (e.g., `#cc0000` or `#990000`)
4. Claude calls `change_model_color` with the new color

### Step 14: MCP Tool Handler for Setting Color

**Location:** `server.js` (example - actual line numbers vary by tool, typically around lines 450-500 for change_model_color)

```javascript
mcpServer.registerTool(
  'change_model_color',
  {
    title: 'Change Model Color',
    description: 'Change the color of the 3D model in the scene',
    inputSchema: {
      color: colorSchema
    }
  },
  async ({ color }) => {
    const hexColor = normalizeColorToHex(color);
    if (!hexColor) {
      return {
        content: [{ type: 'text', text: `Invalid color: ${color}...` }],
        isError: true
      };
    }

    routeToCurrentSession({
      type: 'changeColor',
      color: hexColor
    });

    const displayName = /^#[0-9A-Fa-f]{6}$/.test(color) ? hexColor : `${color} (${hexColor})`;
    return {
      content: [{ type: 'text', text: `Model color changed to ${displayName}` }]
    };
  }
);
```

**What happens:**
1. Tool handler receives the new color (e.g., `"#cc0000"`)
2. Normalizes the color (handles hex codes and Apple crayon color names)
3. Routes the command to the browser using `routeToCurrentSession()`
4. Returns confirmation message to Claude

### Step 15: Routing Command to Browser

**Location:** `server.js` lines 408-430

```javascript
function routeToCurrentSession(command) {
  const sessionId = sessionContext.getStore();
  if (sessionId) {
    console.error(`Routing command to session: ${sessionId}`, command.type);
    sendToSession(sessionId, command);
  } else if (isStdioMode) {
    // In STDIO mode, route to the unique STDIO session ID
    if (STDIO_SESSION_ID) {
      console.error(`Routing command in STDIO mode to session: ${STDIO_SESSION_ID}`, command.type);
      sendToSession(STDIO_SESSION_ID, command);
    } else {
      // Fallback: broadcast to all clients
      broadcastToClients(command);
    }
  } else {
    console.warn('Tool handler called but no session context available.');
  }
}
```

**Message sent:**
```json
{
  "type": "changeColor",
  "color": "#cc0000"
}
```

### Step 16: Browser Receives Command

**Location:** `src/WebSocketClient.js` lines 127-131

```javascript
// Handle regular commands
console.log('Received command:', data);

if (this.onCommand) {
  this.onCommand(data);
}
```

**Location:** `src/Application.js` lines 510-513

```javascript
this.wsClient = new WebSocketClient(
  (command) => {
    this._handleWebSocketCommand(command);
  },
  // ... other callbacks ...
);
```

### Step 17: Application Handles Command

**Location:** `src/Application.js` lines 548-564

```javascript
_handleWebSocketCommand(command) {
  // Skip state updates for getter commands and toolCall notifications
  const isGetterCommand = command.type.startsWith('get');
  const isToolCallNotification = command.type === 'toolCall';
  
  const handler = this.commandHandlers.get(command.type);
  if (handler) {
    handler(command);
    
    // Send state update after executing state-modifying commands
    if (!isGetterCommand && !isToolCallNotification) {
      this._sendStateUpdate();  // ← Automatic state update push
    }
  } else {
    console.warn('Unknown command type:', command.type);
  }
}
```

**Location:** `src/Application.js` lines 67-69

```javascript
['changeColor', (command) => {
  this.sceneManager.changeModelColor(command.color);
}],
```

### Step 18: SceneManager Updates Model Color

**Location:** `src/SceneManager.js` lines 315-318

```javascript
changeModelColor(color) {
  const hexColor = parseInt(color.replace('#', ''), 16);
  this.model.getMaterial().color.setHex(hexColor);
}
```

**What happens:**
1. Converts hex string to integer (e.g., `"#cc0000"` → `13369344`)
2. Sets the Three.js material color directly
3. The model's color changes in the 3D scene

### Step 19: Automatic State Update Push

**Location:** `src/Application.js` lines 673-678

```javascript
_sendStateUpdate() {
  if (this.wsClient && this.wsClient.isConnected()) {
    const state = this.getSceneState();  // Get fresh state
    this.wsClient.sendStateUpdate(state);  // Push to server
  }
}
```

**Location:** `src/WebSocketClient.js` lines 302-310

```javascript
sendStateUpdate(state) {
  if (this.isConnected()) {
    this.ws.send(JSON.stringify({
      type: 'stateUpdate',
      state: state,
      timestamp: Date.now()
    }));
  }
}
```

**Message sent:**
```json
{
  "type": "stateUpdate",
  "state": {
    "model": {
      "color": "#cc0000",  // ← Updated color
      "scale": { "x": 1.0, "y": 1.0, "z": 1.0 },
      "rotation": { "x": 0, "y": 0, "z": 0 }
    },
    "background": "#000000",
    "keyLight": { /* ... */ },
    "fillLight": { /* ... */ },
    "camera": { /* ... */ }
  },
  "timestamp": 1704067200000
}
```

### Step 20: Server Updates Cache

**Location:** `server.js` lines 214-222

```javascript
// Handle state update messages (push updates)
if (data.type === 'stateUpdate' && data.state) {
  sessionStateCache.set(sessionId, {
    state: data.state,
    timestamp: data.timestamp || Date.now()
  });
  console.warn(`State cache updated for session ${sessionId}`);
  return;
}
```

**What happens:**
1. Server receives `stateUpdate` message
2. Updates `sessionStateCache` with the new state
3. Future queries will return this updated cached state (unless `forceRefresh = true`)

### Step 21: Response to Claude

The tool handler returns:

```
Model color changed to #cc0000
```

**Claude receives:** Confirmation that the color was changed.

---

## Part 3: How State is Used in Subsequent Queries

### Scenario: User Asks "What color is it now?" (after command)

**Flow:**
1. Claude calls `get_model_color` again
2. `getState(sessionId, false)` is called (default: no force refresh)
3. **Cache hit:** `sessionStateCache.get(sessionId)` returns the cached state
4. Returns `"#cc0000"` immediately (no browser query needed)

**Performance:** This query is **instant** (~0ms) because it uses the cache.

**When this works:** After Claude sends a command (e.g., `change_model_color`), the browser automatically pushes a state update, so the cache is fresh.

### Scenario: User Manually Rotates Model, Then Asks "What's the rotation?"

**Flow:**
1. User drags mouse to rotate the model (manual interaction)
2. `RotationController` updates the model rotation directly in Three.js
3. **No state update sent to server** - cache is now stale
4. Claude calls `get_model_rotation`
5. `getState(sessionId, false)` is called (default: no force refresh)
6. **Cache hit:** Returns stale rotation values (wrong!)
7. OR: Claude calls `get_model_rotation` with `forceRefresh: true`
8. `getState(sessionId, true)` queries browser
9. Browser returns **actual current rotation** from Three.js scene
10. Returns correct rotation values

**Key Point:** Manual interactions don't trigger state updates, so `forceRefresh` is needed to get accurate state after user interactions.

### Scenario: User Asks "What color is it now?" (with force refresh)

**Flow:**
1. Claude calls `get_model_color` with `forceRefresh: true`
2. `getState(sessionId, true)` is called
3. **Force refresh:** Always queries browser, even if cache exists
4. Browser returns fresh state
5. Returns the actual current color

**Use case:** Essential when the user has manually interacted with the 3D app (mouse rotation, camera zoom, touch gestures, etc.). These manual interactions change the state locally but **do not trigger automatic state updates** to the server, so the cache becomes stale. `forceRefresh` queries the browser to get the actual current state snapshot.

---

## Key Architectural Patterns

### 1. Request-Response Correlation

**Problem:** WebSocket is asynchronous. Multiple queries can be in flight simultaneously.

**Solution:** Use unique `requestId` (UUID) to correlate requests with responses.

**Implementation:**
- `pendingStateQueries` Map stores Promise resolvers/rejecters keyed by `requestId`
- Browser includes `requestId` in response
- Server looks up Promise and resolves/rejects it

### 2. State Caching (Hybrid Approach)

**Problem:** Querying browser for every state request is slow (network latency).

**Solution:** Cache state on server, update cache when state changes.

**Implementation:**
- `sessionStateCache` Map stores state per session
- Browser pushes `stateUpdate` after each command
- Queries return cached state by default (fast)
- Optional `forceRefresh` parameter for fresh queries (accurate)

### 3. Automatic State Updates

**Problem:** Cache can become stale if browser state changes without commands.

**Solution:** Browser automatically pushes state updates after every state-modifying **WebSocket command**.

**Implementation:**
- `_handleWebSocketCommand()` calls `_sendStateUpdate()` after non-getter commands
- Server receives `stateUpdate` and updates cache
- Cache stays fresh for **command-driven changes**

**Important Limitation:** Manual user interactions (mouse rotation, camera zoom, touch gestures, area light manipulation) **do NOT trigger automatic state updates**. These interactions modify the Three.js scene state directly but don't send WebSocket messages. This is why `forceRefresh` exists - to capture the actual current state after manual interactions.

### 4. Session Context Management

**Problem:** In STDIO mode, there's no HTTP request context to identify the session.

**Solution:** Use `AsyncLocalStorage` for HTTP mode, global variable for STDIO mode.

**Implementation:**
- `getCurrentSessionId()` helper function handles both modes
- HTTP mode: `sessionContext.getStore()` (from AsyncLocalStorage)
- STDIO mode: `STDIO_SESSION_ID` (set when browser connects)

---

## Data Flow Diagram

```
┌─────────┐
│ Claude  │
└────┬────┘
     │ 1. get_model_color()
     ▼
┌─────────────────────────────────────┐
│ MCP Server (server.js)               │
│                                      │
│ get_model_color tool handler         │
│   ↓                                  │
│ getState(sessionId, forceRefresh)    │
│   ├─ Cache hit? → return cached     │
│   └─ Cache miss? → query browser    │
│       ↓                              │
│   queryStateFromBrowser()            │
│     ├─ generateRequestId()          │
│     ├─ sendToSession(requestState)  │
│     └─ waitForStateResponse()       │
│         └─ Promise stored in Map    │
└────┬────────────────────────────────┘
     │ 2. WebSocket: requestState
     ▼
┌─────────────────────────────────────┐
│ Browser (WebSocketClient.js)       │
│                                      │
│ Receives requestState               │
│   ↓                                  │
│ _handleStateQuery()                 │
│   ↓                                  │
│ Calls onStateQuery callback         │
└────┬────────────────────────────────┘
     │ 3. Callback to Application
     ▼
┌─────────────────────────────────────┐
│ Application.js                      │
│                                      │
│ getSceneState()                     │
│   ↓                                  │
│ Calls SceneManager getters:         │
│   - getModelColor()                  │
│   - getModelScale()                  │
│   - getKeyLightIntensity()          │
│   - ...                              │
└────┬────────────────────────────────┘
     │ 4. Returns state object
     ▼
┌─────────────────────────────────────┐
│ WebSocketClient.js                 │
│                                      │
│ _sendStateResponse(requestId, state)│
└────┬────────────────────────────────┘
     │ 5. WebSocket: stateResponse
     ▼
┌─────────────────────────────────────┐
│ MCP Server (server.js)             │
│                                      │
│ Receives stateResponse              │
│   ↓                                  │
│ Looks up Promise by requestId       │
│   ↓                                  │
│ Resolves Promise with state         │
│   ↓                                  │
│ Returns state to tool handler       │
│   ↓                                  │
│ Extracts model.color                 │
└────┬────────────────────────────────┘
     │ 6. "Model color: #ff0000"
     ▼
┌─────────┐
│ Claude  │
└─────────┘

[User asks to darken color]

┌─────────┐
│ Claude  │
└────┬────┘
     │ 7. change_model_color("#cc0000")
     ▼
┌─────────────────────────────────────┐
│ MCP Server (server.js)               │
│                                      │
│ change_model_color tool handler      │
│   ↓                                  │
│ routeToCurrentSession()              │
│   ↓                                  │
│ sendToSession({type: "changeColor"}) │
└────┬────────────────────────────────┘
     │ 8. WebSocket: changeColor
     ▼
┌─────────────────────────────────────┐
│ Application.js                      │
│                                      │
│ _handleWebSocketCommand()           │
│   ↓                                  │
│ Calls handler: changeColor           │
│   ↓                                  │
│ sceneManager.changeModelColor()     │
│   ↓                                  │
│ [Model color changes in 3D scene]   │
│   ↓                                  │
│ _sendStateUpdate()                  │
└────┬────────────────────────────────┘
     │ 9. WebSocket: stateUpdate
     ▼
┌─────────────────────────────────────┐
│ MCP Server (server.js)              │
│                                      │
│ Receives stateUpdate                 │
│   ↓                                  │
│ Updates sessionStateCache            │
│   ↓                                  │
│ [Cache now has latest state]         │
└─────────────────────────────────────┘
```

---

## Performance Characteristics

### Query with Cache Hit
- **Latency:** ~0ms (in-memory Map lookup)
- **Network calls:** 0
- **Use case:** Default behavior for all queries

### Query with Cache Miss
- **Latency:** ~10-50ms (WebSocket round-trip)
- **Network calls:** 1 (requestState → stateResponse)
- **Use case:** First query after browser connects, or after cache cleared

### Query with Force Refresh
- **Latency:** ~10-50ms (WebSocket round-trip)
- **Network calls:** 1 (requestState → stateResponse)
- **Use case:** When accuracy is critical, or verifying cache matches reality

### Command Execution
- **Latency:** ~5-20ms (WebSocket one-way message)
- **Network calls:** 1 (command → browser)
- **State update:** Automatic push after command (~5-20ms additional)

---

## Error Handling

### Browser Disconnected During Query

**Scenario:** Browser closes WebSocket connection while query is pending.

**Handling:**
1. `waitForStateResponse()` timeout fires (2 seconds)
2. Promise rejects with timeout error
3. `getState()` checks for cached state
4. If cache exists, returns cached state with warning
5. If no cache, returns error to Claude

**Location:** `server.js` lines 328-378

### Browser Disconnected During Command

**Scenario:** Browser closes WebSocket connection when command is sent.

**Handling:**
1. `sendToSession()` returns `false`
2. Tool handler can detect this and return error to Claude
3. Current implementation doesn't check return value, but could be added

**Location:** `server.js` lines 274-284

### Invalid State Response

**Scenario:** Browser sends malformed `stateResponse`.

**Handling:**
1. JSON parsing error caught in WebSocket message handler
2. Error logged, Promise not resolved
3. Timeout fires after 2 seconds
4. Error returned to Claude

**Location:** `server.js` lines 200-230 (WebSocket message handling)

---

## Summary: The Complete Round-Trip

1. **Query Flow:**
   - Claude → MCP tool → `getState()` → Cache check → (if miss) Query browser → Browser retrieves state → Response → Cache update → Return to Claude

2. **Command Flow:**
   - Claude → MCP tool → Route command → Browser executes → State changes → Automatic state update push → Cache update → Confirmation to Claude

3. **Subsequent Queries:**
   - Claude → MCP tool → `getState()` → Cache hit → Instant return to Claude

The system elegantly balances **speed** (caching) with **accuracy** (force refresh), while automatically keeping the cache fresh through push updates after every command.

