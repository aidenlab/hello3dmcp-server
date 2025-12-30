import { Container } from "@cloudflare/containers";

// Define the Container class
export class MCPContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "5m";
  
  // Constructor receives Worker environment (env) as second parameter
  // We can access Worker vars (from wrangler.jsonc) via env.BROWSER_URL
  constructor(ctx, env) {
    super(ctx, env);
    
    // Set environment variables that will be passed to the container
    // envVars is a PROPERTY, not a method - it's used when the container starts
    // Get BROWSER_URL from Worker vars (set in wrangler.jsonc vars section)
    const browserUrl = env.BROWSER_URL || 'https://hello3dmcp-frontend.netlify.app';
    
    // Debug logging
    console.log('[MCPContainer] Constructor called with env:', {
      BROWSER_URL_from_worker: env.BROWSER_URL,
      BROWSER_URL_final: browserUrl,
      all_env_keys: Object.keys(env)
    });
    
    // Set the envVars property (this will be passed to the container when it starts)
    this.envVars = {
      BROWSER_URL: browserUrl,
    };
    
    // Additional debug logging
    console.log('[MCPContainer] envVars property set:', this.envVars);
  }
}

// Worker entry point
export default {
  async fetch(request, env) {
    // Debug: Log environment variables
    console.log('[Worker] Environment variables:', {
      BROWSER_URL: env.BROWSER_URL,
      all_vars: Object.keys(env).filter(k => k.startsWith('BROWSER') || k === 'MCP_CONTAINER')
    });
    
    // Get or create a container instance using a Durable Object ID
    // Use idFromName to create a consistent ID for the container
    const id = env.MCP_CONTAINER.idFromName("default");
    const container = env.MCP_CONTAINER.get(id);
    
    // Log request details for debugging
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');
    const isWebSocket = upgradeHeader === 'websocket';
    
    console.log(`[Worker] ${request.method} ${url.pathname}${url.search}`, {
      isWebSocket,
      upgrade: upgradeHeader,
      connection: request.headers.get('Connection'),
      pathname: url.pathname
    });
    
    // Check if this is a WebSocket upgrade request
    if (isWebSocket) {
      console.log(`[Worker] WebSocket upgrade detected for ${url.pathname}`);
      
      // For WebSocket upgrades, we need to forward the request to the container
      // and return the WebSocket response directly
      try {
        const response = await container.fetch(request);
        
        // Check if the container returned a WebSocket
        if (response.webSocket) {
          console.log(`[Worker] Container returned WebSocket, forwarding to client`);
          return new Response(null, {
            status: 101,
            webSocket: response.webSocket,
          });
        }
        
        // If container didn't return WebSocket but status is 101, try to get it
        if (response.status === 101) {
          console.log(`[Worker] Container returned 101 status but no WebSocket`);
        }
        
        console.log(`[Worker] Container response: ${response.status}`, {
          headers: Object.fromEntries(response.headers.entries())
        });
        
        return response;
      } catch (error) {
        console.error(`[Worker] Error forwarding WebSocket upgrade:`, error);
        return new Response(`Error forwarding WebSocket upgrade: ${error.message}`, { 
          status: 500 
        });
      }
    }
    
    // Handle regular HTTP requests
    try {
      const response = await container.fetch(request);
      console.log(`[Worker] HTTP Response status: ${response.status}`);
      return response;
    } catch (error) {
      console.error(`[Worker] Error forwarding request:`, error);
      return new Response(`Error forwarding request: ${error.message}`, { 
        status: 500 
      });
    }
  }
};

