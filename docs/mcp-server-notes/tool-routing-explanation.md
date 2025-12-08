# Tool Routing: From MCP Tool Names to Application Methods

This document explains how MCP tool names registered in `server.js` connect to actual method calls in the application code.

## Overview

The connection between tool names and application methods is **indirect** and happens through a two-step mapping process:

1. **Tool Name → Command Type**: Tool handlers in `server.js` convert MCP tool names to command types
2. **Command Type → Method Call**: `Application.js` maps command types to `SceneManager` method calls

## Step 1: Tool Name → Command Type (server.js)

When an MCP tool is called (e.g., `change_model_color`), the tool handler creates a command object with a `type` property and routes it to the browser client via WebSocket.

### Example: change_model_color

```javascript
// server.js (example - actual line numbers vary by tool)
mcpServer.registerTool(
  'change_model_color',  // MCP tool name (snake_case)
  {
    title: 'Change Model Color',
    description: 'Change the color of the 3D model in the scene',
    inputSchema: {
      color: colorSchema
    }
  },
  async ({ color }) => {
    // ... validation ...
    
    routeToCurrentSession({
      type: 'changeColor',  // Command type (camelCase)
      color: hexColor
    });
    
    // ... return response ...
  }
);
```

**Key Point**: The tool name `'change_model_color'` (snake_case) is converted to command type `'changeColor'` (camelCase) in the tool handler.

### Routing Function

The `routeToCurrentSession()` function (server.js lines 408-430) sends commands to the browser client via WebSocket:

```javascript
function routeToCurrentSession(command) {
  const sessionId = sessionContext.getStore();
  if (sessionId) {
    console.log(`Routing command to session: ${sessionId}`, command.type);
    sendToSession(sessionId, command);
  } else {
    console.warn('Tool handler called but no session context available.');
  }
}
```

## Step 2: Command Type → Method Call (Application.js)

The browser client receives WebSocket messages and routes them through a command handler map.

### Command Handler Map

`Application.js` initializes a `commandHandlers` Map that maps command types to handler functions:

```javascript
// Application.js lines 58-90
_initCommandHandlers() {
  this.commandHandlers = new Map([
    ['changeColor', (command) => {
      this.sceneManager.changeModelColor(command.color);
    }],
    ['changeSize', (command) => {
      this.sceneManager.changeModelSize(command.size);
    }],
    ['scaleModel', (command) => {
      this.sceneManager.scaleModel(command.x, command.y, command.z);
    }],
    ['changeBackgroundColor', (command) => {
      this.sceneManager.changeBackgroundColor(command.color);
    }],
    // ... more handlers ...
  ]);
}
```

### WebSocket Command Handling

When a WebSocket message arrives, it's processed by `_handleWebSocketCommand()`:

```javascript
// Application.js lines 344-351
_handleWebSocketCommand(command) {
  const handler = this.commandHandlers.get(command.type);
  if (handler) {
    handler(command);
  } else {
    console.warn('Unknown command type:', command.type);
  }
}
```

The `WebSocketClient` (WebSocketClient.js line 103) receives messages and calls the `onCommand` callback:

```javascript
this.ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (this.onCommand) {
    this.onCommand(data);  // Calls Application._handleWebSocketCommand
  }
};
```

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Client (ChatGPT)                                       │
│ Calls tool: 'change_model_color' with { color: "#ff0000" } │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ server.js: Tool Handler (line 225)                         │
│ - Validates input                                          │
│ - Normalizes color                                         │
│ - Creates command: { type: 'changeColor', color: '#ff0000' }│
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ server.js: routeToCurrentSession() (line 165)              │
│ - Gets session ID from AsyncLocalStorage                    │
│ - Sends command via WebSocket                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ WebSocket: Message sent to browser client                  │
│ { type: 'changeColor', color: '#ff0000' }                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ WebSocketClient.js: onmessage (line 103)                   │
│ - Parses JSON message                                      │
│ - Calls onCommand callback                                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Application.js: _handleWebSocketCommand() (line 344)       │
│ - Looks up handler in commandHandlers Map                  │
│ - Handler key: 'changeColor'                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ Application.js: commandHandlers.get('changeColor')         │
│ Handler function: (command) => {                           │
│   this.sceneManager.changeModelColor(command.color);       │
│ }                                                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ SceneManager.js: changeModelColor() (line 104)             │
│ - Updates model material color                             │
│ - Render happens automatically via animation loop          │
└─────────────────────────────────────────────────────────────┘
```

## Tool Name to Command Type Mapping

Here's a reference table showing how tool names map to command types:

| MCP Tool Name (server.js) | Command Type (server.js → Application.js) | SceneManager Method (Application.js) |
|---------------------------|-------------------------------------------|--------------------------------------|
| `change_model_color` | `changeColor` | `changeModelColor()` |
| `change_model_size` | `changeSize` | `changeModelSize()` |
| `scale_model` | `scaleModel` | `scaleModel()` |
| `change_background_color` | `changeBackgroundColor` | `changeBackgroundColor()` |
| `set_key_light_intensity` | `setKeyLightIntensity` | `setKeyLightIntensity()` |
| `set_key_light_position` | `setKeyLightPosition` | `setKeyLightPosition()` |
| `set_key_light_color` | `setKeyLightColor` | `setKeyLightColor()` |
| `set_key_light_size` | `setKeyLightSize` | `setKeyLightSize()` |
| `set_fill_light_intensity` | `setFillLightIntensity` | `setFillLightIntensity()` |
| `set_fill_light_position` | `setFillLightPosition` | `setFillLightPosition()` |
| `set_fill_light_color` | `setFillLightColor` | `setFillLightColor()` |
| `set_fill_light_size` | `setFillLightSize` | `setFillLightSize()` |

## Key Design Decisions

1. **Decoupling**: Tool names (MCP API) are separate from internal method names, allowing independent naming conventions
2. **Snake_case → camelCase**: Tool names use snake_case (MCP convention), command types use camelCase (JavaScript convention)
3. **Command Object Pattern**: Commands are objects with a `type` property, making them extensible
4. **Session Context**: `AsyncLocalStorage` maintains session context across async operations in the MCP server

## Adding New Tools

To add a new tool:

1. **Register the tool in server.js**:
   ```javascript
   mcpServer.registerTool(
     'new_tool_name',
     { /* schema */ },
     async ({ param }) => {
       routeToCurrentSession({
         type: 'newCommandType',
         param: param
       });
       return { /* response */ };
     }
   );
   ```

2. **Add handler in Application.js**:
   ```javascript
   // In _initCommandHandlers()
   ['newCommandType', (command) => {
     this.sceneManager.newMethod(command.param);
   }]
   ```

3. **Implement method in SceneManager.js**:
   ```javascript
   newMethod(param) {
     // Implementation
   }
   ```

## Related Files

- `server.js`: Tool registration and WebSocket routing
- `src/Application.js`: Command handler map and WebSocket client setup
- `src/WebSocketClient.js`: WebSocket message handling
- `src/SceneManager.js`: Actual implementation methods

