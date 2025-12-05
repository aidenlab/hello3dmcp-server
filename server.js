import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { appleCrayonColorsHexStrings } from './src/utils/color/color.js';

// Parse command line arguments
function parseCommandLineArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--browser-url' || arg === '-u') {
      args.browserUrl = process.argv[++i];
    } else if (arg.startsWith('--browser-url=')) {
      args.browserUrl = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node server.js [options]

Options:
  --browser-url, -u <url>    Browser URL for the 3D app (e.g., https://your-app.netlify.app)
                             Overrides BROWSER_URL environment variable
  --help, -h                 Show this help message

Environment Variables:
  BROWSER_URL                Browser URL (used if --browser-url not provided)
  MCP_PORT                   MCP server port (default: 3000)
  WS_PORT                    WebSocket server port (default: 3001)

Configuration Priority:
  1. Command line argument (--browser-url)
  2. Environment variable (BROWSER_URL)
  3. Default (http://localhost:5173)

Examples:
  node server.js --browser-url https://my-app.netlify.app
  node server.js -u http://localhost:5173
      `);
      process.exit(0);
    }
  }
  return args;
}

const cliArgs = parseCommandLineArgs();

const MCP_PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : 3000;
const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3001;
// Browser URL for the 3D app (Netlify deployment)
// Priority: 1) Command line argument (--browser-url), 2) Environment variable (BROWSER_URL), 
//           3) Default (localhost)
// For .mcpb packages, configuration comes from manifest.json env defaults
const BROWSER_URL = cliArgs.browserUrl || process.env.BROWSER_URL || 'http://localhost:5173';

/**
 * Converts a color input (hex code or Apple crayon color name) to a hex code
 * @param {string} colorInput - Either a hex code (e.g., "#ff0000") or an Apple crayon color name (e.g., "maraschino")
 * @returns {string|null} Hex color code or null if invalid
 */
function normalizeColorToHex(colorInput) {
  if (!colorInput || typeof colorInput !== 'string') {
    return null;
  }
  
  // Check if it's already a hex code
  if (/^#[0-9A-Fa-f]{6}$/.test(colorInput)) {
    return colorInput.toLowerCase();
  }
  
  // Normalize the input: lowercase, trim, and handle variations
  let normalizedName = colorInput.toLowerCase().trim();
  
  // Handle "sea foam" variations (with space, without space, with hyphen)
  if (normalizedName === 'seafoam' || normalizedName === 'sea-foam') {
    normalizedName = 'sea foam';
  }
  
  // Try to find it as an Apple crayon color name
  const hexColor = appleCrayonColorsHexStrings.get(normalizedName);
  
  if (hexColor) {
    return hexColor.toLowerCase();
  }
  
  return null;
}

// Store connected WebSocket clients by session ID
// Map<sessionId, WebSocket>
const wsClients = new Map();

// Store pending state queries for request-response correlation
// Map<requestId, {resolve, reject, timeout}>
const pendingStateQueries = new Map();

// Store cached state per session
// Map<sessionId, {state: object, timestamp: number}>
const sessionStateCache = new Map();

// Default timeout for state queries (2 seconds)
const STATE_QUERY_TIMEOUT = 2000;

// Create WebSocket server for browser communication
const wss = new WebSocketServer({ port: WS_PORT });

// Handle WebSocket server errors (e.g., port already in use)
wss.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ ERROR: Port ${WS_PORT} is already in use.`);
    console.error(`   Another instance of the server may be running.`);
    console.error(`   To fix this:`);
    console.error(`   1. Find the process using port ${WS_PORT}: lsof -i :${WS_PORT}`);
    console.error(`   2. Kill it: kill <PID>`);
    console.error(`   3. Or change WS_PORT in your environment\n`);
    process.exit(1);
  } else {
    console.error('WebSocket server error:', error);
    process.exit(1);
  }
});

wss.on('listening', () => {
  // Use console.error to avoid interfering with MCP protocol on stdout
  console.error(`WebSocket server listening on ws://localhost:${WS_PORT}`);
});

wss.on('connection', (ws) => {
  console.warn('Browser client connected (waiting for session ID)');
  let sessionId = null;

  // Handle incoming messages from clients
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      // First message should be session registration
      if (data.type === 'registerSession' && data.sessionId) {
        sessionId = data.sessionId;
        wsClients.set(sessionId, ws);
        console.warn(`Browser client registered with session ID: ${sessionId}`);
        
        // Send confirmation
        ws.send(JSON.stringify({
          type: 'sessionRegistered',
          sessionId: sessionId
        }));
      } else if (sessionId) {
        // Handle state response messages
        if (data.type === 'stateResponse' && data.requestId) {
          const query = pendingStateQueries.get(data.requestId);
          if (query) {
            clearTimeout(query.timeout);
            pendingStateQueries.delete(data.requestId);
            query.resolve(data.state);
          } else {
            console.warn(`Received state response for unknown requestId: ${data.requestId}`);
          }
          return;
        }
        
        // Handle state update messages (push updates)
        if (data.type === 'stateUpdate' && data.state) {
          sessionStateCache.set(sessionId, {
            state: data.state,
            timestamp: data.timestamp || Date.now()
          });
          console.warn(`State cache updated for session ${sessionId}`);
          return;
        }
        
        // Handle state error messages
        if (data.type === 'stateError' && data.requestId) {
          const query = pendingStateQueries.get(data.requestId);
          if (query) {
            clearTimeout(query.timeout);
            pendingStateQueries.delete(data.requestId);
            query.reject(new Error(data.error || 'State query failed'));
          }
          return;
        }
        
        // Handle other messages (for testing/debugging)
        console.warn(`Received command from client (session ${sessionId}):`, data);
        // Note: We no longer broadcast client-to-client messages
        // If needed, this could route to a specific session
      } else {
        console.warn('Received message from unregistered client');
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Session not registered. Please send registerSession message first.'
        }));
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    if (sessionId) {
      console.warn(`Browser client disconnected (session: ${sessionId})`);
      wsClients.delete(sessionId);
      // Clear state cache for disconnected session
      sessionStateCache.delete(sessionId);
      // Reject any pending queries for this session
      for (const [requestId, query] of pendingStateQueries.entries()) {
        clearTimeout(query.timeout);
        pendingStateQueries.delete(requestId);
        query.reject(new Error('Browser disconnected'));
      }
    } else {
      console.warn('Browser client disconnected (unregistered)');
    }
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error (session: ${sessionId || 'unregistered'}):`, error);
  });
});

// Send command to a specific session's browser client
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

// Generate a unique request ID for state queries
function generateRequestId() {
  return randomUUID();
}

// Wait for a state response from the browser
// Returns a Promise that resolves with the state or rejects on timeout/error
function waitForStateResponse(requestId, timeout = STATE_QUERY_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingStateQueries.delete(requestId);
      reject(new Error('State query timeout'));
    }, timeout);
    
    pendingStateQueries.set(requestId, {
      resolve,
      reject,
      timeout: timeoutId
    });
  });
}

// Query state from browser (with optional force refresh)
async function queryStateFromBrowser(sessionId, forceRefresh = false) {
  const requestId = generateRequestId();
  
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

// Get state (cached or fresh)
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
        // If query fails and no cache, throw error
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

// Format state response with metadata for tool responses
function formatStateResponse(value, propertyName, sessionId, forceRefresh, metadata) {
  const timestamp = metadata.timestamp;
  const source = metadata.source;
  const stalenessWarning = metadata.wasCached 
    ? ' (may be stale if user manually interacted)' 
    : '';
  
  return `${propertyName}: ${value} (queried at ${timestamp}, source: ${source}${stalenessWarning})`;
}

// Helper function to query fresh state before relative manipulations
async function queryFreshStateForManipulation(sessionId) {
  try {
    const { state } = await getState(sessionId, true); // Always force refresh
    return state;
  } catch (error) {
    console.warn(`Failed to query fresh state before manipulation: ${error.message}`);
    return null;
  }
}

// Request-scoped context for current session ID using AsyncLocalStorage
// This maintains context across async operations
const sessionContext = new AsyncLocalStorage();

// Helper function for tool handlers to route commands to the current request's session
// Note: getCurrentSessionId() is defined later after isStdioMode and STDIO_SESSION_ID are declared
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
      console.error('Routing command in STDIO mode - no session ID available, broadcasting to all clients:', command.type);
      if (wsClients.size > 0) {
        broadcastToClients(command);
      } else {
        console.error('No WebSocket clients connected. Command not routed:', command.type);
      }
    }
  } else {
    console.warn('Tool handler called but no session context available. Command not routed.');
    console.warn('Current request session ID:', sessionId);
  }
}

// Broadcast command to all connected browser clients (kept for backward compatibility if needed)
function broadcastToClients(command) {
  const message = JSON.stringify(command);
  wsClients.forEach((client, sessionId) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
}

// Create MCP server
const mcpServer = new McpServer({
  name: '3d-model-server',
  version: '1.0.0'
});

// Create a list of available Apple crayon color names for the description
const availableColorNames = Array.from(appleCrayonColorsHexStrings.keys()).join(', ');

// Zod schema for color input - accepts hex codes or Apple crayon color names
const colorSchema = z.string().refine(
  (val) => {
    // Accept hex codes
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      return true;
    }
    // Accept Apple crayon color names (case-insensitive)
    let normalizedName = val.toLowerCase().trim();
    // Handle "sea foam" variations
    if (normalizedName === 'seafoam' || normalizedName === 'sea-foam') {
      normalizedName = 'sea foam';
    }
    return appleCrayonColorsHexStrings.has(normalizedName);
  },
  {
    message: `Must be a hex color code (e.g., "#ff0000") or an Apple crayon color name. Available colors: ${availableColorNames}`
  }
).describe(`Hex color code (e.g., "#ff0000") or Apple crayon color name (e.g., "maraschino", "turquoise", "lemon"). Available colors: ${availableColorNames}`);

// Register tool: change_model_color
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
        content: [
          {
            type: 'text',
            text: `Invalid color: ${color}. Please use a hex code (e.g., "#ff0000") or an Apple crayon color name.`
          }
        ],
        isError: true
      };
    }

    routeToCurrentSession({
      type: 'changeColor',
      color: hexColor
    });

    const displayName = /^#[0-9A-Fa-f]{6}$/.test(color) ? hexColor : `${color} (${hexColor})`;
    return {
      content: [
        {
          type: 'text',
          text: `Model color changed to ${displayName}`
        }
      ]
    };
  }
);

// Register tool: change_model_size
mcpServer.registerTool(
  'change_model_size',
  {
    title: 'Change Model Size',
    description: 'Change the uniform size of the 3D model',
    inputSchema: {
      size: z.number().positive().describe('New size value (uniform scaling)')
    }
  },
  async ({ size }) => {
    routeToCurrentSession({
      type: 'changeSize',
      size: size
    });

    return {
      content: [
        {
          type: 'text',
          text: `Model size changed to ${size}`
        }
      ]
    };
  }
);

// Register tool: scale_model
mcpServer.registerTool(
  'scale_model',
  {
    title: 'Scale Model',
    description: 'Scale the 3D model independently in each dimension (x, y, z)',
    inputSchema: {
      x: z.number().positive().describe('Scale factor for X axis'),
      y: z.number().positive().describe('Scale factor for Y axis'),
      z: z.number().positive().describe('Scale factor for Z axis')
    }
  },
  async ({ x, y, z }) => {
    routeToCurrentSession({
      type: 'scaleModel',
      x: x,
      y: y,
      z: z
    });

    return {
      content: [
        {
          type: 'text',
          text: `Model scaled to (${x}, ${y}, ${z})`
        }
      ]
    };
  }
);

// Register tool: change_background_color
mcpServer.registerTool(
  'change_background_color',
  {
    title: 'Change Background Color',
    description: 'Change the background color of the 3D scene',
    inputSchema: {
      color: colorSchema
    }
  },
  async ({ color }) => {
    const hexColor = normalizeColorToHex(color);
    if (!hexColor) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid color: ${color}. Please use a hex code (e.g., "#000000") or an Apple crayon color name.`
          }
        ],
        isError: true
      };
    }

    routeToCurrentSession({
      type: 'changeBackgroundColor',
      color: hexColor
    });

    const displayName = /^#[0-9A-Fa-f]{6}$/.test(color) ? hexColor : `${color} (${hexColor})`;
    return {
      content: [
        {
          type: 'text',
          text: `Background color changed to ${displayName}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'get_background_color',
  {
    title: 'Get Background Color',
    description: 'Get the current scene background color as a hex color code (e.g., "#000000"). ' +
      'Query this before relative color changes to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const color = state.background || '#000000';
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(color, 'Background color', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      // If browser disconnected, try to return cached state with warning
      const cached = sessionStateCache.get(sessionId);
      if (cached && cached.state?.background) {
        return {
          content: [
            {
              type: 'text',
              text: `Background color: ${cached.state.background} (last known state - browser may be disconnected)`
            }
          ]
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving background color: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

// Key light control tools
mcpServer.registerTool(
  'set_key_light_intensity',
  {
    title: 'Set Key Light Intensity',
    description: 'Set the intensity of the key light (main light source)',
    inputSchema: {
      intensity: z.number().nonnegative().describe('Light intensity value (0.0 or higher)')
    }
  },
  async ({ intensity }) => {
    routeToCurrentSession({
      type: 'setKeyLightIntensity',
      intensity: intensity
    });

    return {
      content: [
        {
          type: 'text',
          text: `Key light intensity set to ${intensity}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'set_key_light_color',
  {
    title: 'Set Key Light Color',
    description: 'Set the color of the key light',
    inputSchema: {
      color: colorSchema
    }
  },
  async ({ color }) => {
    const hexColor = normalizeColorToHex(color);
    if (!hexColor) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid color: ${color}. Please use a hex code (e.g., "#ffffff") or an Apple crayon color name.`
          }
        ],
        isError: true
      };
    }

    routeToCurrentSession({
      type: 'setKeyLightColor',
      color: hexColor
    });

    const displayName = /^#[0-9A-Fa-f]{6}$/.test(color) ? hexColor : `${color} (${hexColor})`;
    return {
      content: [
        {
          type: 'text',
          text: `Key light color changed to ${displayName}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'swing_key_light_up',
  {
    title: 'Swing Key Light Up',
    description: 'Rotate the key light upward in an arc around the center of the model',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'swingKeyLightUp'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Key light swung up'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'swing_key_light_down',
  {
    title: 'Swing Key Light Down',
    description: 'Rotate the key light downward in an arc around the center of the model',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'swingKeyLightDown'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Key light swung down'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'swing_key_light_left',
  {
    title: 'Swing Key Light Left',
    description: 'Rotate the key light leftward in an arc around the center of the model',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'swingKeyLightLeft'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Key light swung left'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'swing_key_light_right',
  {
    title: 'Swing Key Light Right',
    description: 'Rotate the key light rightward in an arc around the center of the model',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'swingKeyLightRight'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Key light swung right'
        }
      ]
    };
  }
);

// Fill light control tools
mcpServer.registerTool(
  'set_fill_light_intensity',
  {
    title: 'Set Fill Light Intensity',
    description: 'Set the intensity of the fill light (shadow-filling light)',
    inputSchema: {
      intensity: z.number().nonnegative().describe('Light intensity value (0.0 or higher)')
    }
  },
  async ({ intensity }) => {
    routeToCurrentSession({
      type: 'setFillLightIntensity',
      intensity: intensity
    });

    return {
      content: [
        {
          type: 'text',
          text: `Fill light intensity set to ${intensity}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'set_fill_light_color',
  {
    title: 'Set Fill Light Color',
    description: 'Set the color of the fill light',
    inputSchema: {
      color: colorSchema
    }
  },
  async ({ color }) => {
    const hexColor = normalizeColorToHex(color);
    if (!hexColor) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid color: ${color}. Please use a hex code (e.g., "#ffffff") or an Apple crayon color name.`
          }
        ],
        isError: true
      };
    }

    routeToCurrentSession({
      type: 'setFillLightColor',
      color: hexColor
    });

    const displayName = /^#[0-9A-Fa-f]{6}$/.test(color) ? hexColor : `${color} (${hexColor})`;
    return {
      content: [
        {
          type: 'text',
          text: `Fill light color changed to ${displayName}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'swing_fill_light_up',
  {
    title: 'Swing Fill Light Up',
    description: 'Rotate the fill light upward in an arc around the center of the model',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'swingFillLightUp'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Fill light swung up'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'swing_fill_light_down',
  {
    title: 'Swing Fill Light Down',
    description: 'Rotate the fill light downward in an arc around the center of the model',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'swingFillLightDown'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Fill light swung down'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'swing_fill_light_left',
  {
    title: 'Swing Fill Light Left',
    description: 'Rotate the fill light leftward in an arc around the center of the model',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'swingFillLightLeft'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Fill light swung left'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'swing_fill_light_right',
  {
    title: 'Swing Fill Light Right',
    description: 'Rotate the fill light rightward in an arc around the center of the model',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'swingFillLightRight'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Fill light swung right'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'walk_key_light_in',
  {
    title: 'Walk Key Light In',
    description: 'Move the key light closer to the center of the model along the axis from the model origin',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'walkKeyLightIn'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Key light walked in'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'walk_key_light_out',
  {
    title: 'Walk Key Light Out',
    description: 'Move the key light farther from the center of the model along the axis from the model origin',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'walkKeyLightOut'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Key light walked out'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'walk_fill_light_in',
  {
    title: 'Walk Fill Light In',
    description: 'Move the fill light closer to the center of the model along the axis from the model origin',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'walkFillLightIn'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Fill light walked in'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'walk_fill_light_out',
  {
    title: 'Walk Fill Light Out',
    description: 'Move the fill light farther from the center of the model along the axis from the model origin',
    inputSchema: {}
  },
  async () => {
    routeToCurrentSession({
      type: 'walkFillLightOut'
    });

    return {
      content: [
        {
          type: 'text',
          text: 'Fill light walked out'
        }
      ]
    };
  }
);

// Direction name to azimuth mapping (matches CoordinateSystem.js)
const directionToAzimuthMap = new Map([
  ['north', 0], ['east', 90], ['south', 180], ['west', 270],
  ['northeast', 45], ['northwest', 315], ['southeast', 135], ['southwest', 225],
  ['n', 0], ['e', 90], ['s', 180], ['w', 270],
  ['ne', 45], ['nw', 315], ['se', 135], ['sw', 225],
  ['nne', 22.5], ['ene', 67.5], ['ese', 112.5], ['sse', 157.5],
  ['ssw', 202.5], ['wsw', 247.5], ['wnw', 292.5], ['nnw', 337.5],
]);

// Helper function to normalize direction names
function normalizeDirectionName(direction) {
  if (!direction || typeof direction !== 'string') {
    return null;
  }
  let normalized = direction.toLowerCase().trim();
  normalized = normalized.replace(/[\s\-\.]/g, '');
  return normalized;
}

// Helper function to convert direction name or number to azimuth
function parseAzimuth(input) {
  if (typeof input === 'number') {
    return input;
  }
  if (typeof input === 'string') {
    const normalized = normalizeDirectionName(input);
    if (normalized && directionToAzimuthMap.has(normalized)) {
      return directionToAzimuthMap.get(normalized);
    }
  }
  return null;
}

// Zod schema for azimuth - accepts numbers (0-360) or direction names
const availableDirectionNames = Array.from(directionToAzimuthMap.keys()).filter(name => name.length > 1).join(', ');
const azimuthSchema = z.union([
  z.number().min(0).max(360),
  z.string().refine(
    (val) => {
      const normalized = normalizeDirectionName(val);
      return normalized && directionToAzimuthMap.has(normalized);
    },
    {
      message: `Must be a number (0-360) or a direction name. Available directions: ${availableDirectionNames}`
    }
  )
]).describe(`Horizontal angle in degrees (0-360) or direction name (e.g., "north", "northwest", "NW"). 0° = camera forward (North), 90° = camera right (East), 180° = behind camera (South), 270° = camera left (West). Available directions: ${availableDirectionNames}`);

// Spherical coordinate tools for camera-centric positioning
mcpServer.registerTool(
  'set_key_light_position_spherical',
  {
    title: 'Set Key Light Position (Spherical Coordinates)',
    description: `Set the key light position using camera-centric spherical coordinates. Preserves current distance - only changes azimuth and elevation. Azimuth: 0° = camera forward (North), 90° = camera right (East), 180° = behind camera (South), 270° = camera left (West). Elevation: 0° = horizon, 90° = overhead. Azimuth can be a number (0-360) or a direction name. Available direction names: ${availableDirectionNames}. Examples: "north" (0°), "east" (90°), "northwest" (315°), "southeast" (135°).`,
    inputSchema: {
      azimuth: azimuthSchema,
      elevation: z.number().min(0).max(90).describe('Vertical angle in degrees (0-90), 0° = horizon, 90° = overhead')
    }
  },
  async ({ azimuth, elevation }) => {
    // Convert direction name to numeric azimuth if needed
    const azimuthValue = parseAzimuth(azimuth);
    if (azimuthValue === null) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid azimuth: ${azimuth}. Must be a number (0-360) or a direction name.`
          }
        ],
        isError: true
      };
    }

    routeToCurrentSession({
      type: 'setKeyLightPositionSpherical',
      azimuth: azimuthValue,
      elevation: elevation
    });

    const azimuthDisplay = typeof azimuth === 'string' ? `${azimuth} (${azimuthValue}°)` : `${azimuthValue}°`;
    return {
      content: [
        {
          type: 'text',
          text: `Key light positioned at azimuth ${azimuthDisplay}, elevation ${elevation}° (distance preserved)`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'get_key_light_position_spherical',
  {
    title: 'Get Key Light Position (Spherical Coordinates)',
    description: 'Get the current key light position in camera-centric spherical coordinates. ' +
      'Query this before relative position changes (e.g., "rotate light 10 degrees") to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const position = state.keyLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
      const positionText = `azimuth ${position.azimuth}°, elevation ${position.elevation}°, distance ${position.distance}`;
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(positionText, 'Key light position', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving key light position: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

mcpServer.registerTool(
  'get_key_light_intensity',
  {
    title: 'Get Key Light Intensity',
    description: 'Get the current key light intensity value (0.0 or higher). ' +
      'Query this before relative intensity changes (e.g., "increase by 0.5") to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const intensity = state.keyLight?.intensity ?? 0;
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(intensity.toString(), 'Key light intensity', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving key light intensity: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

mcpServer.registerTool(
  'get_key_light_color',
  {
    title: 'Get Key Light Color',
    description: 'Get the current key light color as a hex color code (e.g., "#ffffff"). ' +
      'Query this before relative color changes to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const color = state.keyLight?.color || '#ffffff';
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(color, 'Key light color', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving key light color: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

mcpServer.registerTool(
  'get_key_light_size',
  {
    title: 'Get Key Light Size',
    description: 'Get the current key light area size (width and height in units). ' +
      'Query this before relative size changes to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const size = state.keyLight?.size || { width: 1, height: 1 };
      const sizeText = `width ${size.width}, height ${size.height}`;
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(sizeText, 'Key light size', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving key light size: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

mcpServer.registerTool(
  'set_fill_light_position_spherical',
  {
    title: 'Set Fill Light Position (Spherical Coordinates)',
    description: `Set the fill light position using camera-centric spherical coordinates. Preserves current distance - only changes azimuth and elevation. Azimuth: 0° = camera forward (North), 90° = camera right (East), 180° = behind camera (South), 270° = camera left (West). Elevation: 0° = horizon, 90° = overhead. Azimuth can be a number (0-360) or a direction name. Available direction names: ${availableDirectionNames}. Examples: "north" (0°), "east" (90°), "northwest" (315°), "southeast" (135°).`,
    inputSchema: {
      azimuth: azimuthSchema,
      elevation: z.number().min(0).max(90).describe('Vertical angle in degrees (0-90), 0° = horizon, 90° = overhead')
    }
  },
  async ({ azimuth, elevation }) => {
    // Convert direction name to numeric azimuth if needed
    const azimuthValue = parseAzimuth(azimuth);
    if (azimuthValue === null) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid azimuth: ${azimuth}. Must be a number (0-360) or a direction name.`
          }
        ],
        isError: true
      };
    }

    routeToCurrentSession({
      type: 'setFillLightPositionSpherical',
      azimuth: azimuthValue,
      elevation: elevation
    });

    const azimuthDisplay = typeof azimuth === 'string' ? `${azimuth} (${azimuthValue}°)` : `${azimuthValue}°`;
    return {
      content: [
        {
          type: 'text',
          text: `Fill light positioned at azimuth ${azimuthDisplay}, elevation ${elevation}° (distance preserved)`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'get_fill_light_position_spherical',
  {
    title: 'Get Fill Light Position (Spherical Coordinates)',
    description: 'Get the current fill light position in camera-centric spherical coordinates. ' +
      'Query this before relative position changes (e.g., "rotate light 10 degrees") to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const position = state.fillLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
      const positionText = `azimuth ${position.azimuth}°, elevation ${position.elevation}°, distance ${position.distance}`;
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(positionText, 'Fill light position', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving fill light position: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

mcpServer.registerTool(
  'get_fill_light_intensity',
  {
    title: 'Get Fill Light Intensity',
    description: 'Get the current fill light intensity value (0.0 or higher). ' +
      'Query this before relative intensity changes (e.g., "increase by 0.5") to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const intensity = state.fillLight?.intensity ?? 0;
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(intensity.toString(), 'Fill light intensity', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving fill light intensity: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

mcpServer.registerTool(
  'get_fill_light_color',
  {
    title: 'Get Fill Light Color',
    description: 'Get the current fill light color as a hex color code (e.g., "#ffffff"). ' +
      'Query this before relative color changes to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const color = state.fillLight?.color || '#ffffff';
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(color, 'Fill light color', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving fill light color: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

mcpServer.registerTool(
  'get_fill_light_size',
  {
    title: 'Get Fill Light Size',
    description: 'Get the current fill light area size (width and height in units). ' +
      'Query this before relative size changes to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const size = state.fillLight?.size || { width: 1, height: 1 };
      const sizeText = `width ${size.width}, height ${size.height}`;
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(sizeText, 'Fill light size', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving fill light size: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

// Camera control tools
mcpServer.registerTool(
  'dolly_camera',
  {
    title: 'Dolly Camera',
    description: 'Set the camera distance from the origin (dollying). Moves the camera closer or farther from the subject.',
    inputSchema: {
      distance: z.number().positive().describe('Distance from origin (camera position.z)')
    }
  },
  async ({ distance }) => {
    routeToCurrentSession({
      type: 'dollyCamera',
      distance: distance
    });

    return {
      content: [
        {
          type: 'text',
          text: `Camera distance set to ${distance}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'dolly_camera_in',
  {
    title: 'Dolly Camera In',
    description: 'Move the camera closer to the subject (dolly in)',
    inputSchema: {
      amount: z.number().positive().optional().describe('Optional amount to move closer (defaults to configured dolly speed)')
    }
  },
  async ({ amount }) => {
    routeToCurrentSession({
      type: 'dollyCameraIn',
      amount: amount
    });

    return {
      content: [
        {
          type: 'text',
          text: amount ? `Camera moved ${amount} units closer` : 'Camera moved closer'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'dolly_camera_out',
  {
    title: 'Dolly Camera Out',
    description: 'Move the camera farther from the subject (dolly out)',
    inputSchema: {
      amount: z.number().positive().optional().describe('Optional amount to move farther (defaults to configured dolly speed)')
    }
  },
  async ({ amount }) => {
    routeToCurrentSession({
      type: 'dollyCameraOut',
      amount: amount
    });

    return {
      content: [
        {
          type: 'text',
          text: amount ? `Camera moved ${amount} units farther` : 'Camera moved farther'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'set_camera_fov',
  {
    title: 'Set Camera Field of View',
    description: 'Set the camera field of view (FOV). Lower values = wider angle (more of scene visible), higher values = narrower angle (more zoomed in).',
    inputSchema: {
      fov: z.number().positive().describe('Field of view value (typically 0.5-5.0, where lower = wider angle)')
    }
  },
  async ({ fov }) => {
    routeToCurrentSession({
      type: 'setCameraFOV',
      fov: fov
    });

    return {
      content: [
        {
          type: 'text',
          text: `Camera field of view set to ${fov}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'increase_camera_fov',
  {
    title: 'Increase Camera Field of View',
    description: 'Increase the camera field of view (wider angle, see more of the scene)',
    inputSchema: {
      amount: z.number().positive().optional().describe('Optional amount to increase (defaults to configured FOV speed)')
    }
  },
  async ({ amount }) => {
    routeToCurrentSession({
      type: 'increaseCameraFOV',
      amount: amount
    });

    return {
      content: [
        {
          type: 'text',
          text: amount ? `Camera FOV increased by ${amount}` : 'Camera FOV increased (wider angle)'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'decrease_camera_fov',
  {
    title: 'Decrease Camera Field of View',
    description: 'Decrease the camera field of view (narrower angle, more zoomed in)',
    inputSchema: {
      amount: z.number().positive().optional().describe('Optional amount to decrease (defaults to configured FOV speed)')
    }
  },
  async ({ amount }) => {
    routeToCurrentSession({
      type: 'decreaseCameraFOV',
      amount: amount
    });

    return {
      content: [
        {
          type: 'text',
          text: amount ? `Camera FOV decreased by ${amount}` : 'Camera FOV decreased (more zoomed in)'
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'get_camera_distance',
  {
    title: 'Get Camera Distance',
    description: 'Get the current camera distance from origin (dolly position). ' +
      'Query this before relative distance changes to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const distance = state.camera?.distance ?? 0;
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(distance.toString(), 'Camera distance', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving camera distance: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

mcpServer.registerTool(
  'get_camera_fov',
  {
    title: 'Get Camera Field of View',
    description: 'Get the current camera field of view (FOV) value. ' +
      'Query this before relative FOV changes to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const fov = state.camera?.fov ?? 0;
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(fov.toString(), 'Camera FOV', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving camera FOV: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

// Model rotation tools
mcpServer.registerTool(
  'get_model_rotation',
  {
    title: 'Get Model Rotation',
    description: 'Get the current model rotation as Euler angles in degrees (XYZ order). Returns pitch (x), yaw (y), and roll (z) angles. ' +
      'Query this before relative rotation changes (e.g., "rotate 10 degrees") to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const rotation = state.model?.rotation || { x: 0, y: 0, z: 0 };
      const rotationText = `X (pitch): ${rotation.x}°, Y (yaw): ${rotation.y}°, Z (roll): ${rotation.z}°`;
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(rotationText, 'Model rotation', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving model rotation: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

mcpServer.registerTool(
  'get_model_color',
  {
    title: 'Get Model Color',
    description: 'Get the current model color as a hex color code (e.g., "#ff0000"). ' +
      'Query this before relative color changes (e.g., "darken by 10%") to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const color = state.model?.color || '#808080';
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(color, 'Model color', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving model color: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

mcpServer.registerTool(
  'get_model_scale',
  {
    title: 'Get Model Scale',
    description: 'Get the current model scale in each dimension (x, y, z) as scale factors. ' +
      'Query this before relative scale changes (e.g., "scale by 1.5x") to ensure accuracy. ' +
      'For absolute changes, you may use recently queried state from context if no manual interactions occurred.',
    inputSchema: {
      forceRefresh: z.boolean().optional().describe(
        'Force refresh from browser (defaults to false, uses cache). ' +
        'Set to true if: user manually interacted with the 3D app, state might have changed, ' +
        'or accuracy is critical. Use false (default) if state was recently queried and no manual interactions occurred.'
      )
    }
  },
  async ({ forceRefresh = false }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    try {
      const { state, metadata } = await getState(sessionId, forceRefresh);
      const scale = state.model?.scale || { x: 1, y: 1, z: 1 };
      const scaleText = `X: ${scale.x}, Y: ${scale.y}, Z: ${scale.z}`;
      
      return {
        content: [
          {
            type: 'text',
            text: formatStateResponse(scaleText, 'Model scale', sessionId, forceRefresh, metadata)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving model scale: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

mcpServer.registerTool(
  'set_model_rotation',
  {
    title: 'Set Model Rotation',
    description: 'Set the model rotation using Euler angles in degrees (XYZ order). X = pitch (rotation around X axis), Y = yaw (rotation around Y axis), Z = roll (rotation around Z axis).',
    inputSchema: {
      x: z.number().describe('Rotation around X axis in degrees (pitch)'),
      y: z.number().describe('Rotation around Y axis in degrees (yaw)'),
      z: z.number().describe('Rotation around Z axis in degrees (roll)')
    }
  },
  async ({ x, y, z }) => {
    routeToCurrentSession({
      type: 'setModelRotation',
      x: x,
      y: y,
      z: z
    });

    return {
      content: [
        {
          type: 'text',
          text: `Model rotation set to X: ${x}°, Y: ${y}°, Z: ${z}°`
        }
      ]
    };
  }
);

// Model rotation relative adjustment tools
mcpServer.registerTool(
  'rotate_model_clockwise',
  {
    title: 'Rotate Model Clockwise',
    description: 'Rotate the model clockwise around Y axis (yaw) relative to current rotation. ' +
      'This tool automatically queries fresh state before performing the rotation to ensure accuracy, ' +
      'even if the user has manually interacted with the model.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to rotate in degrees (defaults to 10°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    let currentState = null;
    try {
      const { state } = await getState(sessionId, true); // forceRefresh: true
      currentState = state.model?.rotation || { x: 0, y: 0, z: 0 };
    } catch (error) {
      // If state query fails, proceed anyway but note it in response
      console.warn(`Failed to query state before rotation: ${error.message}`);
    }

    routeToCurrentSession({
      type: 'rotateModelClockwise',
      degrees: degrees
    });

    const rotationInfo = currentState 
      ? ` (from current rotation: Y=${currentState.y}°)`
      : '';
    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Model rotated ${degrees}° clockwise${rotationInfo}` 
            : `Model rotated 10° clockwise${rotationInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'rotate_model_counterclockwise',
  {
    title: 'Rotate Model Counterclockwise',
    description: 'Rotate the model counterclockwise around Y axis (yaw) relative to current rotation. ' +
      'This tool automatically queries fresh state before performing the rotation to ensure accuracy, ' +
      'even if the user has manually interacted with the model.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to rotate in degrees (defaults to 10°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    let currentState = null;
    try {
      const { state } = await getState(sessionId, true); // forceRefresh: true
      currentState = state.model?.rotation || { x: 0, y: 0, z: 0 };
    } catch (error) {
      console.warn(`Failed to query state before rotation: ${error.message}`);
    }

    routeToCurrentSession({
      type: 'rotateModelCounterclockwise',
      degrees: degrees
    });

    const rotationInfo = currentState 
      ? ` (from current rotation: Y=${currentState.y}°)`
      : '';
    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Model rotated ${degrees}° counterclockwise${rotationInfo}` 
            : `Model rotated 10° counterclockwise${rotationInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'nudge_model_pitch_up',
  {
    title: 'Nudge Model Pitch Up',
    description: 'Adjust the model pitch (X axis rotation) upward relative to current rotation. ' +
      'This tool automatically queries fresh state before performing the adjustment to ensure accuracy, ' +
      'even if the user has manually interacted with the model.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to increase pitch in degrees (defaults to 5°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentRotation = state?.model?.rotation || { x: 0, y: 0, z: 0 };
    const rotationInfo = ` (from current pitch: X=${currentRotation.x}°)`;

    routeToCurrentSession({
      type: 'nudgeModelPitchUp',
      degrees: degrees
    });

    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Model pitch increased by ${degrees}°${rotationInfo}` 
            : `Model pitch increased by 5°${rotationInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'nudge_model_pitch_down',
  {
    title: 'Nudge Model Pitch Down',
    description: 'Adjust the model pitch (X axis rotation) downward relative to current rotation. ' +
      'This tool automatically queries fresh state before performing the adjustment to ensure accuracy, ' +
      'even if the user has manually interacted with the model.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to decrease pitch in degrees (defaults to 5°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentRotation = state?.model?.rotation || { x: 0, y: 0, z: 0 };
    const rotationInfo = ` (from current pitch: X=${currentRotation.x}°)`;

    routeToCurrentSession({
      type: 'nudgeModelPitchDown',
      degrees: degrees
    });

    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Model pitch decreased by ${degrees}°${rotationInfo}` 
            : `Model pitch decreased by 5°${rotationInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'nudge_model_roll',
  {
    title: 'Nudge Model Roll',
    description: 'Adjust the model roll (Z axis rotation) relative to current rotation. Positive values rotate clockwise. ' +
      'This tool automatically queries fresh state before performing the adjustment to ensure accuracy, ' +
      'even if the user has manually interacted with the model.',
    inputSchema: {
      degrees: z.number().optional().describe('Amount to adjust roll in degrees (defaults to 5°, positive = clockwise)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentRotation = state?.model?.rotation || { x: 0, y: 0, z: 0 };
    const rotationInfo = ` (from current roll: Z=${currentRotation.z}°)`;

    routeToCurrentSession({
      type: 'nudgeModelRoll',
      degrees: degrees !== undefined ? degrees : 5
    });

    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Model roll adjusted by ${degrees}°${rotationInfo}` 
            : `Model roll adjusted by 5° clockwise${rotationInfo}`
        }
      ]
    };
  }
);

// Key light relative adjustment tools
mcpServer.registerTool(
  'rotate_key_light_clockwise',
  {
    title: 'Rotate Key Light Clockwise',
    description: 'Rotate the key light clockwise (decreases azimuth) relative to current position. ' +
      'This tool automatically queries fresh state before performing the rotation to ensure accuracy, ' +
      'even if the user has manually moved the light.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to rotate in degrees (defaults to 10°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentPosition = state?.keyLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
    const positionInfo = ` (from current azimuth: ${currentPosition.azimuth}°)`;

    routeToCurrentSession({
      type: 'rotateKeyLightClockwise',
      degrees: degrees
    });

    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Key light rotated ${degrees}° clockwise${positionInfo}` 
            : `Key light rotated 10° clockwise${positionInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'rotate_key_light_counterclockwise',
  {
    title: 'Rotate Key Light Counterclockwise',
    description: 'Rotate the key light counterclockwise (increases azimuth) relative to current position. ' +
      'This tool automatically queries fresh state before performing the rotation to ensure accuracy, ' +
      'even if the user has manually moved the light.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to rotate in degrees (defaults to 10°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentPosition = state?.keyLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
    const positionInfo = ` (from current azimuth: ${currentPosition.azimuth}°)`;

    routeToCurrentSession({
      type: 'rotateKeyLightCounterclockwise',
      degrees: degrees
    });

    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Key light rotated ${degrees}° counterclockwise${positionInfo}` 
            : `Key light rotated 10° counterclockwise${positionInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'nudge_key_light_elevation_up',
  {
    title: 'Nudge Key Light Elevation Up',
    description: 'Adjust the key light elevation upward relative to current position. ' +
      'This tool automatically queries fresh state before performing the adjustment to ensure accuracy, ' +
      'even if the user has manually moved the light.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to increase elevation in degrees (defaults to 5°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentPosition = state?.keyLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
    const positionInfo = ` (from current elevation: ${currentPosition.elevation}°)`;

    routeToCurrentSession({
      type: 'nudgeKeyLightElevationUp',
      degrees: degrees
    });

    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Key light elevation increased by ${degrees}°${positionInfo}` 
            : `Key light elevation increased by 5°${positionInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'nudge_key_light_elevation_down',
  {
    title: 'Nudge Key Light Elevation Down',
    description: 'Adjust the key light elevation downward relative to current position. ' +
      'This tool automatically queries fresh state before performing the adjustment to ensure accuracy, ' +
      'even if the user has manually moved the light.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to decrease elevation in degrees (defaults to 5°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentPosition = state?.keyLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
    const positionInfo = ` (from current elevation: ${currentPosition.elevation}°)`;

    routeToCurrentSession({
      type: 'nudgeKeyLightElevationDown',
      degrees: degrees
    });

    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Key light elevation decreased by ${degrees}°${positionInfo}` 
            : `Key light elevation decreased by 5°${positionInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'move_key_light_toward_direction',
  {
    title: 'Move Key Light Toward Direction',
    description: `Move the key light toward a specific direction relative to current position. ` +
      `This tool automatically queries fresh state before performing the adjustment to ensure accuracy, ` +
      `even if the user has manually moved the light. Available directions: ${availableDirectionNames}.`,
    inputSchema: {
      direction: azimuthSchema,
      degrees: z.number().positive().optional().describe('Amount to move toward target direction in degrees (defaults to 10°)')
    }
  },
  async ({ direction, degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Convert direction name to numeric azimuth if needed
    const directionValue = parseAzimuth(direction);
    if (directionValue === null && typeof direction !== 'number') {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid direction: ${direction}. Must be a number (0-360) or a direction name.`
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentPosition = state?.keyLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
    const positionInfo = ` (from current azimuth: ${currentPosition.azimuth}°)`;

    routeToCurrentSession({
      type: 'moveKeyLightTowardDirection',
      direction: typeof direction === 'number' ? direction : directionValue,
      degrees: degrees
    });

    const directionDisplay = typeof direction === 'string' ? direction : `${direction}°`;
    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Key light moved ${degrees}° toward ${directionDisplay}${positionInfo}` 
            : `Key light moved 10° toward ${directionDisplay}${positionInfo}`
        }
      ]
    };
  }
);

// Fill light relative adjustment tools
mcpServer.registerTool(
  'rotate_fill_light_clockwise',
  {
    title: 'Rotate Fill Light Clockwise',
    description: 'Rotate the fill light clockwise (decreases azimuth) relative to current position. ' +
      'This tool automatically queries fresh state before performing the rotation to ensure accuracy, ' +
      'even if the user has manually moved the light.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to rotate in degrees (defaults to 10°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentPosition = state?.fillLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
    const positionInfo = ` (from current azimuth: ${currentPosition.azimuth}°)`;

    routeToCurrentSession({
      type: 'rotateFillLightClockwise',
      degrees: degrees
    });

    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Fill light rotated ${degrees}° clockwise${positionInfo}` 
            : `Fill light rotated 10° clockwise${positionInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'rotate_fill_light_counterclockwise',
  {
    title: 'Rotate Fill Light Counterclockwise',
    description: 'Rotate the fill light counterclockwise (increases azimuth) relative to current position. ' +
      'This tool automatically queries fresh state before performing the rotation to ensure accuracy, ' +
      'even if the user has manually moved the light.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to rotate in degrees (defaults to 10°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentPosition = state?.fillLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
    const positionInfo = ` (from current azimuth: ${currentPosition.azimuth}°)`;

    routeToCurrentSession({
      type: 'rotateFillLightCounterclockwise',
      degrees: degrees
    });

    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Fill light rotated ${degrees}° counterclockwise${positionInfo}` 
            : `Fill light rotated 10° counterclockwise${positionInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'nudge_fill_light_elevation_up',
  {
    title: 'Nudge Fill Light Elevation Up',
    description: 'Adjust the fill light elevation upward relative to current position. ' +
      'This tool automatically queries fresh state before performing the adjustment to ensure accuracy, ' +
      'even if the user has manually moved the light.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to increase elevation in degrees (defaults to 5°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentPosition = state?.fillLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
    const positionInfo = ` (from current elevation: ${currentPosition.elevation}°)`;

    routeToCurrentSession({
      type: 'nudgeFillLightElevationUp',
      degrees: degrees
    });

    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Fill light elevation increased by ${degrees}°${positionInfo}` 
            : `Fill light elevation increased by 5°${positionInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'nudge_fill_light_elevation_down',
  {
    title: 'Nudge Fill Light Elevation Down',
    description: 'Adjust the fill light elevation downward relative to current position. ' +
      'This tool automatically queries fresh state before performing the adjustment to ensure accuracy, ' +
      'even if the user has manually moved the light.',
    inputSchema: {
      degrees: z.number().positive().optional().describe('Amount to decrease elevation in degrees (defaults to 5°)')
    }
  },
  async ({ degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentPosition = state?.fillLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
    const positionInfo = ` (from current elevation: ${currentPosition.elevation}°)`;

    routeToCurrentSession({
      type: 'nudgeFillLightElevationDown',
      degrees: degrees
    });

    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Fill light elevation decreased by ${degrees}°${positionInfo}` 
            : `Fill light elevation decreased by 5°${positionInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'move_fill_light_toward_direction',
  {
    title: 'Move Fill Light Toward Direction',
    description: `Move the fill light toward a specific direction relative to current position. ` +
      `This tool automatically queries fresh state before performing the adjustment to ensure accuracy, ` +
      `even if the user has manually moved the light. Available directions: ${availableDirectionNames}.`,
    inputSchema: {
      direction: azimuthSchema,
      degrees: z.number().positive().optional().describe('Amount to move toward target direction in degrees (defaults to 10°)')
    }
  },
  async ({ direction, degrees }) => {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found.'
          }
        ],
        isError: true
      };
    }

    // Convert direction name to numeric azimuth if needed
    const directionValue = parseAzimuth(direction);
    if (directionValue === null && typeof direction !== 'number') {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid direction: ${direction}. Must be a number (0-360) or a direction name.`
          }
        ],
        isError: true
      };
    }

    // Query fresh state before manipulation
    const state = await queryFreshStateForManipulation(sessionId);
    const currentPosition = state?.fillLight?.position || { azimuth: 0, elevation: 0, distance: 0 };
    const positionInfo = ` (from current azimuth: ${currentPosition.azimuth}°)`;

    routeToCurrentSession({
      type: 'moveFillLightTowardDirection',
      direction: typeof direction === 'number' ? direction : directionValue,
      degrees: degrees
    });

    const directionDisplay = typeof direction === 'string' ? direction : `${direction}°`;
    return {
      content: [
        {
          type: 'text',
          text: degrees 
            ? `Fill light moved ${degrees}° toward ${directionDisplay}${positionInfo}` 
            : `Fill light moved 10° toward ${directionDisplay}${positionInfo}`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'set_key_light_distance',
  {
    title: 'Set Key Light Distance',
    description: 'Set the distance of the key light from the model origin. Preserves current azimuth and elevation angles.',
    inputSchema: {
      distance: z.number().positive().describe('Distance from model origin (positive number, units)')
    }
  },
  async ({ distance }) => {
    routeToCurrentSession({
      type: 'setKeyLightDistance',
      distance: distance
    });

    return {
      content: [
        {
          type: 'text',
          text: `Key light distance set to ${distance} units`
        }
      ]
    };
  }
);

mcpServer.registerTool(
  'set_fill_light_distance',
  {
    title: 'Set Fill Light Distance',
    description: 'Set the distance of the fill light from the model origin. Preserves current azimuth and elevation angles.',
    inputSchema: {
      distance: z.number().positive().describe('Distance from model origin (positive number, units)')
    }
  },
  async ({ distance }) => {
    routeToCurrentSession({
      type: 'setFillLightDistance',
      distance: distance
    });

    return {
      content: [
        {
          type: 'text',
          text: `Fill light distance set to ${distance} units`
        }
      ]
    };
  }
);

// Register tool: get_browser_connection_url
mcpServer.registerTool(
  'get_browser_connection_url',
  {
    title: 'Get Browser Connection URL',
    description: 'Get the URL to open in your browser to connect the 3D visualization app. Use this when users ask how to connect or how to open the 3D app.',
    inputSchema: {}
  },
  async () => {
    // In STDIO mode, use the unique STDIO session ID generated at startup
    // In HTTP mode, get session ID from context
    let sessionId;
    if (isStdioMode) {
      sessionId = STDIO_SESSION_ID;
    } else {
      sessionId = sessionContext.getStore();
    }
    
    if (!sessionId) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No active session found. Please ensure the MCP connection is properly initialized.'
          }
        ],
        isError: true
      };
    }

    const connectionUrl = `${BROWSER_URL}?sessionId=${sessionId}`;
    
    return {
      content: [
        {
          type: 'text',
          text: `To connect your browser to the 3D visualization app, open this URL:\n\n${connectionUrl}\n\nCopy and paste this URL into your web browser to begin interacting with the 3D scene.`
        }
      ]
    };
  }
);

// Set up Express HTTP server for MCP transport
const app = express();
app.use(express.json());

// Enable CORS for ChatGPT and other clients
app.use(
  cors({
    origin: '*', // Allow all origins (restrict in production)
    exposedHeaders: ['Mcp-Session-Id'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
  })
);

// Detect if we're running in STDIO mode (subprocess) or HTTP mode
// If stdin is NOT a TTY, we're being run as a subprocess (STDIO mode)
// If stdin IS a TTY, we're running manually (HTTP mode)
const isStdioMode = !process.stdin.isTTY;

// Map to store transports by session ID (for HTTP mode)
const transports = {};

// For STDIO mode, generate a unique session ID for each process instance
// This ensures each Claude Desktop user gets their own unique session
let STDIO_SESSION_ID = null;

// Helper function to get the current session ID (works in both STDIO and HTTP modes)
// Must be defined after isStdioMode and STDIO_SESSION_ID are declared
function getCurrentSessionId() {
  if (isStdioMode) {
    return STDIO_SESSION_ID;
  } else {
    return sessionContext.getStore();
  }
}

// If running in STDIO mode (subprocess), set up STDIO transport
if (isStdioMode) {
  // Generate a unique session ID for this STDIO connection
  // Each time Claude Desktop starts the server, it's a new process, so we get a new unique ID
  STDIO_SESSION_ID = randomUUID();
  
  console.error('Running in STDIO mode (subprocess)');
  const stdioTransport = new StdioServerTransport();
  
  // Connect MCP server to STDIO transport
  mcpServer.connect(stdioTransport).catch((error) => {
    console.error('Error connecting MCP server to STDIO transport:', error);
    process.exit(1);
  });
  
  // In STDIO mode, route tool calls to all connected WebSocket clients
  // We'll modify the tool handlers to broadcast instead of using session context
  console.error('MCP server connected via STDIO transport');
  // WebSocket server listening message is logged by the 'listening' event handler
  console.error(`Browser URL configured: ${BROWSER_URL}`);
  console.error(`STDIO session ID: ${STDIO_SESSION_ID}`);
} else {
  console.error('Running in HTTP/SSE mode');
}

// Handle POST requests (initialization and tool calls) - only in HTTP mode
if (!isStdioMode) {
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  
  // Log request for debugging (use stderr to avoid interfering with MCP protocol on stdout)
  if (sessionId) {
    console.error(`Received MCP request for session: ${sessionId}, method: ${req.body?.method || 'unknown'}`);
  } else {
    console.error(`Received MCP request (no session), method: ${req.body?.method || 'unknown'}, body:`, JSON.stringify(req.body).substring(0, 200));
  }
  
  try {
    let transport;
    
    if (sessionId && transports[sessionId]) {
      // Reuse existing transport for subsequent requests
      transport = transports[sessionId];
    } else if (sessionId && !transports[sessionId]) {
      // Session ID provided but transport doesn't exist - session expired or lost
      // Allow re-initialization if this is an initialize request
      if (isInitializeRequest(req.body)) {
        console.error(`Session ${sessionId} not found, creating new transport for re-initialization`);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId, // Reuse the same session ID
          onsessioninitialized: (sid) => {
            console.error(`MCP session re-initialized: ${sid}`);
            transports[sid] = transport;
          }
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            console.error(`MCP session closed: ${sid}`);
            delete transports[sid];
          }
        };

        await mcpServer.connect(transport);
      } else {
        // Session ID exists but transport is missing and not an init request
        // Return 404 as per MCP spec - this tells ChatGPT the session doesn't exist
        console.error(`Session ${sessionId} not found for non-init request`);
        res.status(404).json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Session not found'
          },
          id: req.body?.id || null
        });
        return;
      }
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // Create new transport for initialization
      console.error('Creating new transport for initialization');
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          console.error(`MCP session initialized: ${sid}`);
          transports[sid] = transport;
        }
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && transports[sid]) {
          console.error(`MCP session closed: ${sid}`);
          delete transports[sid];
        }
      };

      // Connect transport to MCP server
      await mcpServer.connect(transport);
    } else {
      // Invalid request - no session ID or not initialization request
      console.error('Invalid request:', {
        hasSessionId: !!sessionId,
        isInitialize: isInitializeRequest(req.body),
        method: req.body?.method,
        body: JSON.stringify(req.body).substring(0, 200)
      });
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided or invalid initialization request'
        },
        id: req.body?.id || null
      });
      return;
    }

    // Use AsyncLocalStorage to maintain session context across async operations
    // This ensures tool handlers can access the sessionId even when called asynchronously
    try {
      await sessionContext.run(sessionId || null, async () => {
        console.error(`Setting request context for session: ${sessionId || 'null'}`);

        // Detect tool calls and notify WebSocket clients
        if (req.body?.method === 'tools/call' && req.body?.params?.name) {
          const toolName = req.body.params.name;
          console.error(`MCP tool called: ${toolName} (session: ${sessionId || 'unknown'})`);
          
          // Send tool call notification to specific session's browser client
          if (sessionId) {
            const sent = sendToSession(sessionId, {
              type: 'toolCall',
              toolName: toolName,
              timestamp: Date.now()
            });
            if (!sent) {
              console.warn(`Tool call notification not sent - no browser connected for session: ${sessionId}`);
            }
          }
        }

        // Handle the POST request - tool handlers will be called during this
        // The sessionContext will maintain the sessionId across all async operations
        await transport.handleRequest(req, res, req.body);
        
        console.error(`Request handling complete for session: ${sessionId || 'null'}`);
      });
    } catch (error) {
      console.error('Error handling MCP POST request:', error);
      
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error'
          },
          id: null
        });
      }
    }
  } catch (error) {
    console.error('Error in MCP POST handler (transport setup):', error);
    
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error'
        },
        id: null
      });
    }
  }
});
}

// Handle GET requests for SSE streams - only in HTTP mode
if (!isStdioMode) {
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  try {
    const transport = transports[sessionId];
    const lastEventId = req.headers['last-event-id'];
    
    if (lastEventId) {
      console.error(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
    } else {
      console.error(`Establishing new SSE stream for session ${sessionId}`);
    }
    
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling MCP GET request:', error);
    if (!res.headersSent) {
      res.status(500).send('Error processing SSE stream');
    }
  }
});
}

// Handle DELETE requests for session termination - only in HTTP mode
if (!isStdioMode) {
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }

  try {
    console.error(`Received session termination request for session ${sessionId}`);
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling session termination:', error);
    if (!res.headersSent) {
      res.status(500).send('Error processing session termination');
    }
  }
});
}

// Serve static files from dist folder (for unified deployment) - only in HTTP mode
if (!isStdioMode) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const distPath = join(__dirname, 'dist');

  if (existsSync(distPath)) {
    app.use(express.static(distPath));
    // Serve index.html for all non-API routes (SPA routing)
    // Use middleware function instead of route pattern to avoid path-to-regexp issues
    // This will only be called for routes that don't match static files
    app.use((req, res, next) => {
      // Skip if this is an MCP route
      if (req.path.startsWith('/mcp')) {
        return next();
      }
      // Only handle GET requests for SPA routing
      if (req.method === 'GET') {
        res.sendFile(join(distPath, 'index.html'));
      } else {
        next();
      }
    });
  }

  // Start HTTP server
  app.listen(MCP_PORT, () => {
    // Use console.error for startup messages to avoid interfering with MCP protocol on stdout
    console.error(`MCP Server listening on http://localhost:${MCP_PORT}/mcp`);
    // WebSocket server listening message is logged by the 'listening' event handler
    console.error(`Browser URL configured: ${BROWSER_URL}`);
    if (existsSync(distPath)) {
      console.error(`Serving static files from ${distPath}`);
    }
  });
}

// Handle server shutdown
process.on('SIGINT', async () => {
  console.warn('Shutting down servers...');
  
  // Close all WebSocket connections
  wss.close();
  
  // Close all MCP transports
  for (const sessionId in transports) {
    try {
      await transports[sessionId].close();
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }
  
  await mcpServer.close();
  process.exit(0);
});

