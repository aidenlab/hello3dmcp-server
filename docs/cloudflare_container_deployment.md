# Deploying `hello3dmcp-server` to Cloudflare Containers

This document provides a practical, developer-friendly guide for deploying the [`hello3dmcp-server`](https://github.com/aidenlab/hello3dmcp-server) project to **Cloudflare Containers**. It covers containerization, registry pushes, Worker proxying, local testing, and production considerations.

Cloudflare Containers is currently a **beta** platform designed for running real Docker images at Cloudflare's edge. This allows you to deploy full Node.js services (including WebSockets) with global reach.

**📖 Related Documentation:**
- **[Architecture & Communication Flow](cloudflare-containers-architecture.md)** - Detailed explanation of server components, communication flows, ports, and why certain issues occur. **Read this if you need to understand how everything works together.**

---

## 1. Overview

`hello3dmcp-server` is a Node.js MCP + WebSocket server that exposes:

- An HTTP MCP endpoint (default: port **3000**)
- A WebSocket server for real‑time 3D client communication (default: port **3000** at `/ws`, or port **3001** with `USE_SEPARATE_WS_PORT=true`)

**Important:** For Cloudflare compatibility, WebSockets are served on the same port as HTTP (port 3000) by default. This allows the Worker proxy to forward both HTTP and WebSocket traffic through a single port.

Cloudflare Containers can run the server globally, but Containers are **private by default**. To expose them publicly, you generally route traffic using a **Cloudflare Worker**.

**Deployment pattern:**

1. Dockerize the MCP server
2. Push the image to Cloudflare's Container Registry
3. Deploy a Cloudflare Container resource referencing that image
4. Create a Worker that forwards HTTP/WebSocket traffic into the container
5. Deploy via `wrangler deploy`

---

## 2. Prerequisites

Before starting, ensure you have:

- **Docker** (e.g., Docker Desktop or a compatible engine)
  - **Important:** Make sure Docker Desktop is running before proceeding. On macOS, open Docker Desktop from Applications and wait until you see "Docker Desktop is running" in the menu bar. You can verify Docker is running with: `docker ps` (should not show an error)
- **Wrangler CLI** (`npm i -g wrangler` or npx)
- A **Cloudflare account** with access to the Containers beta

**Important Account Note:** For this project, use the **Theaidenlab@gmail.com** Cloudflare account, which has access to the Containers beta. You can verify which account you're using with `npx wrangler whoami` and set the `account_id` in your `wrangler.jsonc` or `wrangler.toml` file accordingly.

**Important:** Cloudflare Containers is currently in **beta**. If you get an "Unauthorized" error:
1. Make sure Containers beta is enabled on your account (check Cloudflare Dashboard → Workers & Pages → Containers)
2. Verify your account has the necessary permissions
3. Try logging out and back in: `npx wrangler logout` then `npx wrangler login`
4. Ensure you're using the correct account (check with `npx wrangler whoami`)

---

## 3. Add a Dockerfile to the Project

Create a file named `Dockerfile` at the root of the repository:

```dockerfile
# Node runtime (Server requires Node 18+)
FROM node:18-alpine

WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Add source code
COPY . .

# Expose MCP + WebSocket ports
EXPOSE 3000
EXPOSE 3001

# Force HTTP mode in Docker (since stdin is not a TTY)
ENV FORCE_HTTP_MODE=true

CMD ["node", "server.js"]
```

**Important notes:**
- The `FORCE_HTTP_MODE=true` environment variable ensures the server runs in HTTP mode (not STDIO mode) when running in Docker containers
- Port 3000 is used for HTTP MCP endpoint
- Port 3001 is exposed for backward compatibility, but WebSockets are served on port 3000 by default (at `/ws`) for Cloudflare compatibility

---

## 4. Build the Container Locally

**Before starting:** Make sure Docker Desktop is running. If you get an error like "Cannot connect to the Docker daemon", start Docker Desktop and wait for it to fully initialize.

**⚠️ CRITICAL: Platform Architecture Requirement**

Cloudflare Containers **requires AMD64 (x86_64) architecture**. If you're building on an Apple Silicon Mac (M1/M2/M3), Docker will build ARM64 images by default, which will fail when pushing to Cloudflare.

**Always use the `--platform linux/amd64` flag** when building images for Cloudflare:

From the project root:

```bash
docker build --platform linux/amd64 -t hello3dmcp-server:latest .
```

**Why this is necessary:**
- **Apple Silicon Macs** (M1/M2/M3) build ARM64 images by default
- **Cloudflare's infrastructure** runs AMD64 (x86_64) architecture
- **Without the platform flag**, you'll get: `Image platform (linux/arm64) does not match the expected platform (linux/amd64)`
- **The `--platform` flag** forces Docker to build for AMD64, using emulation if needed

**Note:** Building for AMD64 on ARM64 Macs will be slower due to emulation, but it's necessary for Cloudflare compatibility.

### Testing the Container Directly with Docker

**Default Mode (Recommended for Cloudflare):**
By default, the server serves both HTTP and WebSocket on port 3000. This is the recommended configuration for Cloudflare deployment:

```bash
docker run -p 3000:3000 hello3dmcp-server:latest
```

**Endpoints:**
- MCP HTTP endpoint: `http://localhost:3000/mcp`
- WebSocket endpoint: `ws://localhost:3000/ws`

**Legacy Mode (Separate WebSocket Port):**
If you need backward compatibility with a separate WebSocket port (port 3001), use:

```bash
docker run -p 3000:3000 -p 3001:3001 -e USE_SEPARATE_WS_PORT=true hello3dmcp-server:latest
```

**Endpoints:**
- MCP HTTP endpoint: `http://localhost:3000/mcp`
- WebSocket endpoint: `ws://localhost:3001` (separate port)

**⚠️ Important Port Note:** 
- **Default mode** (no `USE_SEPARATE_WS_PORT`): WebSocket is on port 3000 at `/ws` - **This is required for Cloudflare**
- **Legacy mode** (`USE_SEPARATE_WS_PORT=true`): WebSocket is on port 3001 - **Only use this for direct Docker testing if needed**

**Configuring the Browser URL:**

**Test with Netlify-hosted frontend:**
```bash
docker run -p 3000:3000 \
  -e BROWSER_URL=https://hello3dmcp-frontend.netlify.app \
  hello3dmcp-server:latest
```

**Test with local frontend (e.g., Vite dev server on port 5173):**
```bash
docker run -p 3000:3000 \
  -e BROWSER_URL=http://localhost:5173 \
  hello3dmcp-server:latest
```

**Note:** Use the `-e BROWSER_URL` environment variable to configure which frontend the server should connect to. This is especially useful when testing with MCP Inspector - you can switch between your local development frontend and the Netlify-hosted production frontend.

---

## 5. Push to Cloudflare Container Registry

**Important:** Make sure you're authenticated with Cloudflare first:

```bash
npx wrangler login
```

This will open a browser window for you to authenticate with your Cloudflare account.

**If you have multiple Cloudflare accounts**, you'll need to specify which account to use. For this project, use the **Theaidenlab@gmail.com** account. Either:
- Set `account_id` in your `wrangler.toml` or `wrangler.jsonc` file (account ID: `1eadb18bb8557fd1bd06b1d0310a902e`), or
- Set the `CLOUDFLARE_ACCOUNT_ID` environment variable

Then, use Wrangler to build and push the container:

```bash
npx wrangler containers build . -p -t hello3dmcp-server:latest
```

**⚠️ Important Platform Note:** 
- `wrangler containers build` builds using your **local Docker**, which means:
  - On **Apple Silicon Macs** (M1/M2/M3), it will build **ARM64** images by default
  - This will **fail** when pushing to Cloudflare (which requires AMD64)
- **Solution:** If you're on Apple Silicon, you have two options:

  **Option 1: Build locally first with platform flag, then push:**
  ```bash
  docker build --platform linux/amd64 -t hello3dmcp-server:latest .
  docker tag hello3dmcp-server:latest registry.cloudflare.com/<account-id>/hello3dmcp-server:latest
  npx wrangler containers push hello3dmcp-server:latest
  ```

  **Option 2: Use Docker Buildx (if available):**
  ```bash
  docker buildx build --platform linux/amd64 -t hello3dmcp-server:latest --load .
  npx wrangler containers push hello3dmcp-server:latest
  ```

**Note:** 
- The `.` specifies the current directory (where your Dockerfile is located)
- The `-p` flag automatically pushes the image to Cloudflare's registry after building
- The command should be run from your project root directory
- If you get a platform mismatch error, use Option 1 above

Wrangler outputs a registry URI similar to:

```
registry.cloudflare.com/<account-id>/hello3dmcp-server:latest
```

**Save this registry URI** - you'll need it in the next step for your `wrangler.toml` configuration.

**⚠️ Important:** After completing step 5, make sure to update the `containers.image` field in your `wrangler.jsonc` (or `wrangler.toml`) file with the actual registry URI you received. Replace the placeholder `<account-id>` with your actual account ID, or use the full registry URI exactly as shown in the output.

**How `wrangler dev` Uses Containers:**

When you run `npx wrangler dev` for local testing:
- **It uses the image from Cloudflare's registry** (specified in `wrangler.jsonc` as `registry.cloudflare.com/...`)
- **But runs it locally** using Docker on your machine
- Wrangler pulls the image from the registry and runs it in a local Docker container
- This means you need to have pushed the image to the registry (Step 5) before `wrangler dev` will work
- The container runs locally, but uses the same image that will be deployed to Cloudflare in production

**In summary:** `wrangler dev` = Cloudflare registry image + local Docker execution. This ensures your local testing matches production behavior.

**Alternative:** If you prefer to build and push separately:

```bash
# Build only
npx wrangler containers build . -t hello3dmcp-server:latest

# Push separately
npx wrangler containers push hello3dmcp-server:latest
```

**⚠️ Platform Architecture Note:** If you're building locally first (instead of using `wrangler containers build`), remember to use `--platform linux/amd64`:

```bash
# Build locally for AMD64 (required for Cloudflare)
docker build --platform linux/amd64 -t hello3dmcp-server:latest .

# Tag for registry
docker tag hello3dmcp-server:latest registry.cloudflare.com/<account-id>/hello3dmcp-server:latest

# Push to registry
npx wrangler containers push hello3dmcp-server:latest
```

---

## 6. Install Required Dependencies

Before creating the Worker, install the Cloudflare Containers package:

```bash
npm install @cloudflare/containers
```

This package provides the `Container` class needed for the Worker proxy.

---

## 7. Create the Worker Proxy (`index.js`)

Create a file named `index.js` at the root of your project. This Worker will proxy requests to your container:

**⚠️ Critical Understanding:** `index.js` is **NOT** part of the Docker container. It's Worker code that runs on Cloudflare's edge and proxies requests to your container. This means:
- Changes to `index.js` do **NOT** require rebuilding the container
- Changes to `index.js` only require redeploying the Worker (see Section 15.1 for details)

```javascript
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
    const browserUrl = env.BROWSER_URL || 'https://hello3dmcp-frontend.netlify.app';
    
    // Set the envVars property (this will be passed to the container when it starts)
    this.envVars = {
      BROWSER_URL: browserUrl,
    };
  }
}

// Worker entry point
export default {
  async fetch(request, env) {
    // Get or create a container instance using a Durable Object ID
    // Use idFromName to create a consistent ID for the container
    const id = env.MCP_CONTAINER.idFromName("default");
    const container = env.MCP_CONTAINER.get(id);
    
    // Forward the incoming request to the container
    // This handles both HTTP and WebSocket connections
    const response = await container.fetch(request);
    return response;
  }
};
```

**Important:** This Worker uses Cloudflare's Durable Objects to manage container instances. The `idFromName("default")` ensures you always get the same container instance.

---

## 8. Create `wrangler.jsonc` (or `wrangler.toml`)

**⚠️ Important: Understanding `wrangler.jsonc` vs Container Image**

`wrangler.jsonc` is **NOT** part of the Docker container image. It's a **configuration file** used by Wrangler CLI and Cloudflare's deployment system. Here's how they relate:

**What Goes Into the Container Image (Dockerfile):**
- Node.js runtime
- Your `server.js` code
- Dependencies from `package.json`
- Environment variables baked at build time (like `FORCE_HTTP_MODE=true`)
- **Built from:** `Dockerfile` → pushed to Cloudflare Container Registry

**What `wrangler.jsonc` Does:**
- **Configures the Cloudflare Worker** (`index.js`) that proxies to your container
- **Tells Cloudflare which container image to use** (via `containers[].image`)
- **Sets up Durable Objects** and SQLite migrations
- **Passes runtime environment variables** to the container (via `containers[].env`)
- **Configures routes, domains, and other Cloudflare settings**
- **Used by:** Wrangler CLI (`wrangler dev`, `wrangler deploy`) and Cloudflare's deployment system

**Think of it this way:**
- **Container Image** = Your application code (built once, stored in registry)
- **`wrangler.jsonc`** = Deployment configuration (how Cloudflare runs your container)

When you deploy, Cloudflare reads `wrangler.jsonc` to know:
1. Which container image to pull from the registry
2. How to configure the Worker that proxies to it
3. What environment variables to pass to the container at runtime
4. How to route traffic to your Worker

**Important:** You should have a basic `wrangler.jsonc` or `wrangler.toml` file for authentication (step 5), but **do NOT add the `containers` section until AFTER you've completed step 5** (pushed the container to the registry).

If you don't have a `wrangler.jsonc` or `wrangler.toml` file yet, create a basic one:

```jsonc
{
  "name": "hello3dmcp-cloudflare",
  "main": "index.js",
  "compatibility_date": "2024-12-01",
  "compatibility_flags": ["nodejs_compat"],
  "account_id": "your-account-id-here"
}
```

**After completing step 5** (after pushing the container), update your `wrangler.jsonc` with the complete configuration:

```jsonc
{
  "name": "hello3dmcp-cloudflare",
  "main": "index.js",
  "compatibility_date": "2024-12-01",
  "compatibility_flags": ["nodejs_compat"],
  "account_id": "1eadb18bb8557fd1bd06b1d0310a902e",
  "durable_objects": {
    "bindings": [
      {
        "name": "MCP_CONTAINER",
        "class_name": "MCPContainer"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["MCPContainer"]
    }
  ],
  "containers": [
    {
      "class_name": "MCPContainer",
      "image": "registry.cloudflare.com/1eadb18bb8557fd1bd06b1d0310a902e/hello3dmcp-server:latest",
      "env": {
        "BROWSER_URL": "https://hello3dmcp-frontend.netlify.app"
      }
    }
  ]
}
```

**Key configuration points:**
- `durable_objects.bindings`: Binds the `MCPContainer` class to the `MCP_CONTAINER` environment variable
- `migrations`: Enables SQLite for the Durable Object (required for Containers)
- `containers`: Array containing container configuration with `class_name`, `image`, and `env`
- `containers[].env`: Environment variables passed to the container (not the Worker)
- `account_id`: Your Cloudflare account ID (for this project: `1eadb18bb8557fd1bd06b1d0310a902e`)

**⚠️ Important: Worker vs Container Environment Variables:**
- **`vars` in `wrangler.jsonc`**: These are for the **Worker** (`index.js`), accessible via `env.BROWSER_URL` in the Worker code
- **`containers[].env`**: These are for the **Container** (`server.js`), accessible via `process.env.BROWSER_URL` in the container
- The container runs as a separate process and does **not** automatically receive Worker `vars`
- To pass environment variables to the container, use `containers[].env` (not `vars`)

**⚠️ Important:** 
- Replace the `image` field with the actual registry URI from step 5
- The `containers` field must be an **array** (not an object)
- The `class_name` in the container config must match the exported class name in `index.js`
- The `migrations` array must be at the **top level** (not nested under `durable_objects`)

**Note:** Add `.wrangler/` to your `.gitignore` file to avoid committing Wrangler's local cache:

```gitignore
# Cloudflare Wrangler
.wrangler/
```

---

## 9. WebSocket Support and Port Configuration

The server has been configured to serve WebSockets on the **same port as HTTP** (port 3000) for Cloudflare compatibility. This is the recommended approach for Cloudflare Containers.

### Port Configuration Explained

**Default Mode (Cloudflare-Compatible):**
- HTTP MCP endpoint: Port 3000 (`/mcp`)
- WebSocket endpoint: Port 3000 (`/ws`)
- **This is the default and required for Cloudflare deployment**

**Legacy Mode (Separate Ports):**
- HTTP MCP endpoint: Port 3000 (`/mcp`)
- WebSocket endpoint: Port 3001 (root path)
- **Only available when `USE_SEPARATE_WS_PORT=true` is set**
- **Use only for direct Docker testing if needed**

### Why Same Port for Cloudflare?

Cloudflare Workers proxy traffic to containers through a single port. By serving both HTTP and WebSocket on port 3000, the Worker can forward both types of traffic seamlessly. This is the standard pattern for Cloudflare Containers.

---

## 10. Local Testing: Two Approaches

There are two ways to test your containerized MCP server locally. Understanding the difference is important for proper testing.

### Approach 1: Test with Wrangler Dev (Recommended for Cloudflare Testing)

This approach tests the **full Cloudflare setup** including the Worker proxy. This is what you'll use in production, so it's the best way to verify your deployment will work.

**Setup:**
1. **First, push your image to Cloudflare's registry** (complete Step 5). `wrangler dev` pulls the image from the registry specified in `wrangler.jsonc`.
2. Ensure your `wrangler.jsonc` is properly configured (see Step 8) with the registry image URI.
3. **Important:** `wrangler dev` uses the **Cloudflare registry image** (not a local Docker image). It pulls this image and runs it locally using Docker. This ensures your local testing matches production.
4. Run: `npx wrangler dev`
5. Check the console output for any errors about container startup or image pulling

**Note:** If you make code changes, you need to rebuild and push the image to the registry again before `wrangler dev` will use the updated version.

**Ports and Endpoints:**
- **Worker proxy runs on:** `http://localhost:8787`
- **MCP HTTP endpoint:** `http://localhost:8787/mcp`
- **WebSocket endpoint:** `ws://localhost:8787/ws`

**How it works:**
- Wrangler starts a local Worker proxy on port 8787
- The Worker forwards requests to your container (which runs on port 3000 internally)
- Both HTTP and WebSocket traffic go through the Worker proxy
- This matches the production Cloudflare setup exactly

**Testing with MCP Inspector:**
```bash
npx @modelcontextprotocol/inspector --transport http --server-url http://localhost:8787/mcp
```

**Frontend WebSocket Configuration:**
When testing with Wrangler Dev, your frontend app should connect to the WebSocket at:
- **WebSocket URL:** `ws://localhost:8787/ws`

**Important:** The frontend connects to port **8787** (the Worker proxy port), not port 3000 or 3001. The Worker proxy forwards the WebSocket connection to the container internally.

**Switching Between Local and Netlify Frontend:**

**⚠️ For Local Testing (`wrangler dev`): Use `.env` file as the single source of truth**

Wrangler automatically reads `.env` and makes those variables available to your Worker. Edit the **`.env` file**:

```bash
# In .env file:
# For local frontend (e.g., Vite dev server on port 5173):
BROWSER_URL=http://localhost:5173

# For Netlify-hosted frontend:
# BROWSER_URL=https://hello3dmcp-frontend.netlify.app
```

**Why `.env`?**
- `.env` is the **single source of truth** for local development
- Wrangler reads `.env` automatically when running `wrangler dev`
- `.env` takes precedence over `wrangler.jsonc` → `vars` for local development
- Simple: one file to edit, no confusion

**For Production Deployment:**
- `.env` files are **NOT** deployed to Cloudflare
- Use `wrangler.jsonc` → `vars` for production:
  ```jsonc
  "vars": {
    "BROWSER_URL": "https://hello3dmcp-frontend.netlify.app"
  }
  ```

**Important:** After changing `BROWSER_URL` in `.env`, you must **restart `wrangler dev`** for the change to take effect (the container needs to restart with the new environment variable).

**When to use:** Use this when you want to test the complete Cloudflare setup before deploying, or when debugging Worker/Container integration issues.

---

### Approach 2: Test with Docker Directly (For Server Debugging)

This approach tests the container **without the Worker proxy**. It's useful for debugging the server itself, but doesn't test the Cloudflare Worker integration.

**Default Mode (Cloudflare-Compatible):**
```bash
docker run -p 3000:3000 hello3dmcp-server:latest
```

**Ports and Endpoints:**
- **Container runs on:** `http://localhost:3000`
- **MCP HTTP endpoint:** `http://localhost:3000/mcp`
- **WebSocket endpoint:** `ws://localhost:3000/ws`

**Legacy Mode (Separate WebSocket Port):**
```bash
docker run -p 3000:3000 -p 3001:3001 -e USE_SEPARATE_WS_PORT=true hello3dmcp-server:latest
```

**Ports and Endpoints:**
- **Container runs on:** `http://localhost:3000`
- **MCP HTTP endpoint:** `http://localhost:3000/mcp`
- **WebSocket endpoint:** `ws://localhost:3001` (separate port)

**Testing with MCP Inspector:**
```bash
# Default mode (port 3000)
npx @modelcontextprotocol/inspector --transport http --server-url http://localhost:3000/mcp

# Legacy mode (port 3001 for WebSocket)
npx @modelcontextprotocol/inspector --transport http --server-url http://localhost:3000/mcp
```

**Frontend WebSocket Configuration:**

**Default Mode (Cloudflare-Compatible):**
- **WebSocket URL:** `ws://localhost:3000/ws`
- The frontend should connect to port **3000** at the `/ws` path

**Legacy Mode (Separate Port):**
- **WebSocket URL:** `ws://localhost:3001`
- The frontend should connect to port **3001** (root path, no `/ws`)

**When to use:** Use this when debugging server-specific issues, testing server changes quickly, or when you don't need to test the Worker integration.

---

### Port Number Summary

| Testing Method | HTTP Port | WebSocket Port | HTTP Endpoint | WebSocket Endpoint | Frontend WebSocket URL |
|---------------|-----------|----------------|---------------|-------------------|------------------------|
| **Wrangler Dev** | 8787 | 8787 | `http://localhost:8787/mcp` | `ws://localhost:8787/ws` | `ws://localhost:8787/ws` |
| **Docker (Default)** | 3000 | 3000 | `http://localhost:3000/mcp` | `ws://localhost:3000/ws` | `ws://localhost:3000/ws` |
| **Docker (Legacy)** | 3000 | 3001 | `http://localhost:3000/mcp` | `ws://localhost:3001` | `ws://localhost:3001` |

**Key Points:**
- **Wrangler Dev** uses port **8787** (Worker proxy port) - **Frontend connects to port 8787**
- **Docker Direct (Default)** uses port **3000** (container port) - **Frontend connects to port 3000**
- **Docker Direct (Legacy)** uses port **3001** for WebSocket - **Frontend connects to port 3001**
- **For Cloudflare deployment**, always use the default mode (same port for HTTP and WebSocket)

### Frontend WebSocket Configuration

Your frontend app needs to know which WebSocket URL to connect to. Configure this via environment variables:

**Important:** The frontend runs in your browser (even if hosted on Netlify), so it **can** connect to `localhost` URLs when testing locally.

#### For Wrangler Dev Testing (Local Testing)

When testing with `npx wrangler dev`, the WebSocket is available at `ws://localhost:8787/ws`:

1. **Update Netlify environment variable:**
   - Go to Netlify Dashboard → Site Settings → Environment Variables
   - Set `VITE_WS_URL` to: `ws://localhost:8787/ws`
   - **Redeploy** your Netlify site after changing the variable

2. **Open the Netlify site in your browser** - it will connect to your local `wrangler dev` server

**Note:** The frontend JavaScript is built at deploy time with the `VITE_WS_URL` value baked in. After changing the environment variable, you must **redeploy** for the change to take effect.

#### For Docker Direct Testing (Default Mode)

If testing with Docker directly (not through Wrangler):

```bash
# Frontend environment variable
VITE_WS_URL=ws://localhost:3000/ws
```

#### For Docker Direct Testing (Legacy Mode)

If using separate WebSocket port:

```bash
# Frontend environment variable
VITE_WS_URL=ws://localhost:3001
```

#### For Production Deployment

When deploying to Cloudflare production, configure Netlify to connect to the production WebSocket URL:

1. **Deploy to Cloudflare:**
   ```bash
   npx wrangler deploy
   ```

2. **Get your production WebSocket URL:**
   - Without custom domain: `wss://hello3dmcp-cloudflare.<subdomain>.workers.dev/ws`
   - With custom domain: `wss://mcp.yourdomain.com/ws`

3. **Update Netlify environment variable:**
   - Key: `VITE_WS_URL`
   - Value: Your production WebSocket URL (use `wss://` for secure WebSocket)
   - **Redeploy** your Netlify site

**Note:** The exact environment variable name depends on your frontend framework. For Vite, use `VITE_` prefix. Adjust based on your build system.

---

## 11. Troubleshooting Common Issues

### Issue: "Cannot connect to the Docker daemon"
**Solution:** Make sure Docker Desktop is running. On macOS, open Docker Desktop from Applications and wait until you see "Docker Desktop is running" in the menu bar.

### Issue: "Unauthorized" during `wrangler containers build`
**Solutions:**
1. Make sure Containers beta is enabled on your account
2. Verify you're logged in: `npx wrangler whoami`
3. Try logging out and back in: `npx wrangler logout` then `npx wrangler login`
4. Ensure `account_id` is set correctly in `wrangler.jsonc`

### Issue: "The 'path' argument must be of type string"
**Solution:** Make sure to include `.` in the command: `npx wrangler containers build . -p -t hello3dmcp-server:latest`

### Issue: "containers field should be an array"
**Solution:** The `containers` field in `wrangler.jsonc` must be an array, not an object:
```jsonc
"containers": [
  {
    "class_name": "MCPContainer",
    "image": "registry.cloudflare.com/..."
  }
]
```

### Issue: "SQL is not enabled for this Durable Object class"
**Solution:** Add a `migrations` section at the top level of `wrangler.jsonc`:
```jsonc
"migrations": [
  {
    "tag": "v1",
    "new_sqlite_classes": ["MCPContainer"]
  }
]
```

### Issue: "Failed to execute 'get' on 'DurableObjectNamespace'"
**Solution:** Make sure you're using `idFromName()` to create a Durable Object ID before calling `get()`:
```javascript
const id = env.MCP_CONTAINER.idFromName("default");
const container = env.MCP_CONTAINER.get(id);
```

### Issue: WebSocket connections not working with `wrangler dev`
**Solution:** 
- Make sure the server is configured to serve WebSockets on the same port as HTTP (port 3000)
- The Worker automatically forwards WebSocket upgrades to the container
- Test at `ws://localhost:8787/ws` (through the Worker proxy)

### Issue: Container not using environment variables from `wrangler.jsonc`

**Problem:** You set `BROWSER_URL` in `vars` but the container isn't using it, defaulting to `http://localhost:5173` instead.

**Cause:** The `vars` section in `wrangler.jsonc` is for the **Worker**, not the **Container**. The container runs as a separate process and doesn't automatically receive Worker environment variables.

**Solution:** Move environment variables from `vars` to `containers[].env`:

```jsonc
{
  "containers": [
    {
      "class_name": "MCPContainer",
      "image": "registry.cloudflare.com/.../hello3dmcp-server:latest",
      "env": {
        "BROWSER_URL": "https://hello3dmcp-frontend.netlify.app"
      }
    }
  ]
  // Remove vars if they were only for the container
}
```

**Key Point:** 
- `vars` → Available to Worker (`env.BROWSER_URL` in `index.js`)
- `containers[].env` → Available to Container (`process.env.BROWSER_URL` in `server.js`)

### Issue: Container not starting or errors during `wrangler dev`
**Solutions:**
1. Clear the Wrangler cache: `rm -rf .wrangler`
2. Make sure your Docker image is built locally with correct platform: `docker build --platform linux/amd64 -t hello3dmcp-server:latest .`
3. Verify the image exists: `docker images | grep hello3dmcp-server`
4. Check that `FORCE_HTTP_MODE=true` is set in the Dockerfile
5. If you see platform architecture errors, rebuild with `--platform linux/amd64` flag

### Issue: Changes not appearing after deployment

**Problem:** You made changes but they're not showing up. You're not sure if you need to rebuild the container or just redeploy.

**Solution:** See **Section 15.1: When to Rebuild vs When to Redeploy** for a complete guide. Quick reference:

- **Changed `index.js` or `wrangler.jsonc`?** → Just redeploy: `npx wrangler deploy` (or restart `wrangler dev`)
- **Changed `server.js` or `package.json`?** → Rebuild container AND redeploy:
  ```bash
  npx wrangler containers build . -t hello3dmcp-server:latest
  npx wrangler deploy
  ```

**Common mistake:** Rebuilding the container when you only changed `index.js` (Worker code). `index.js` is NOT in the container, so rebuilding won't help.

---

## 12. Deploy to Cloudflare

### Basic Deployment

When ready to deploy:

```bash
npx wrangler deploy
```

This deploys:

- Your worker (public)
- Your container (private, globally available)

The output will contain a public URL, for example:

```
https://hello3dmcp-cloudflare.<your-subdomain>.workers.dev
```

**Important:** This is the default Workers.dev subdomain. For production, you'll want to use your custom domain.

---

### Using Custom Domains

If you own domains in your Cloudflare account, you can route traffic to your Worker using custom domains.

#### Option 1: Configure Routes in `wrangler.jsonc` (Recommended)

Add a `routes` section to your `wrangler.jsonc`:

```jsonc
{
  "name": "hello3dmcp-cloudflare",
  "main": "index.js",
  "compatibility_date": "2024-12-01",
  "compatibility_flags": ["nodejs_compat"],
  "account_id": "1eadb18bb8557fd1bd06b1d0310a902e",
  "routes": [
    {
      "pattern": "mcp.yourdomain.com/*",
      "zone_name": "yourdomain.com"
    }
  ],
  // ... rest of configuration
}
```

**What this does:**
- Routes all traffic from `mcp.yourdomain.com` to your Worker
- The Worker forwards to your container
- Works for both HTTP and WebSocket

**Example:**
- HTTP: `https://mcp.yourdomain.com/mcp`
- WebSocket: `wss://mcp.yourdomain.com/ws`

#### Option 2: Configure via Cloudflare Dashboard

1. Go to **Workers & Pages** → Your Worker → **Settings** → **Triggers**
2. Under **Routes**, click **Add Route**
3. Enter your domain pattern (e.g., `mcp.yourdomain.com/*`)
4. Select your zone
5. Save

**Note:** Routes configured in the dashboard override `wrangler.jsonc` routes.

---

### How Ports Work in Production

**Important:** In production, there are **no ports** in URLs. Here's how it works:

#### Local Development (with `wrangler dev`):
```
Frontend → ws://localhost:8787/ws
           ↓
Worker Proxy (port 8787)
           ↓
Container (port 3000)
```

#### Production Deployment:
```
Frontend → wss://mcp.yourdomain.com/ws
           ↓
Cloudflare Edge (no port!)
           ↓
Worker (runs on Cloudflare's infrastructure)
           ↓
Container (port 3000 internally)
```

**Key Differences:**

1. **No Ports in URLs:**
   - Local: `ws://localhost:8787/ws`
   - Production: `wss://mcp.yourdomain.com/ws` (no port number!)

2. **HTTPS/WSS Required:**
   - Local: `ws://` (WebSocket)
   - Production: `wss://` (Secure WebSocket, required for HTTPS domains)

3. **Container Port:**
   - Container still runs on port 3000 **internally**
   - But externally, you access it via domain name
   - Cloudflare handles the routing

4. **Worker Routes:**
   - Workers don't use ports
   - They use **routes** (domain patterns)
   - Traffic matching the route goes to your Worker

---

### Production Deployment Steps

1. **Ensure your image is pushed to registry:**
   ```bash
   docker build --platform linux/amd64 -t hello3dmcp-server:latest .
   docker tag hello3dmcp-server:latest registry.cloudflare.com/<account-id>/hello3dmcp-server:latest
   npx wrangler containers push hello3dmcp-server:latest
   ```

2. **Configure custom domain (if using):**
   - Add `routes` to `wrangler.jsonc`, OR
   - Configure via Cloudflare Dashboard

3. **Deploy:**
   ```bash
   npx wrangler deploy
   ```

4. **Update frontend configuration:**
   - Change WebSocket URL from `ws://localhost:8787/ws` to `wss://mcp.yourdomain.com/ws`
   - Change MCP endpoint from `http://localhost:8787/mcp` to `https://mcp.yourdomain.com/mcp`

---

### Production URLs

**Without Custom Domain (Workers.dev):**
- HTTP: `https://hello3dmcp-cloudflare.<subdomain>.workers.dev/mcp`
- WebSocket: `wss://hello3dmcp-cloudflare.<subdomain>.workers.dev/ws`

**With Custom Domain:**
- HTTP: `https://mcp.yourdomain.com/mcp`
- WebSocket: `wss://mcp.yourdomain.com/ws`

**Note:** Always use `wss://` (secure WebSocket) in production, not `ws://`.

---

## 13. Environment Variables

**⚠️ CRITICAL: `.env` File Takes Precedence EVERYWHERE (Where It's Available)**

**The Golden Rule:** `.env` file takes precedence over `wrangler.jsonc` → `vars` **whenever `.env` is available**.

**When `.env` IS Available (Local Development):**
- **`wrangler dev`** → `.env` takes precedence
- `.env` is the **single source of truth** for local development
- Wrangler automatically reads `.env` and makes those variables available to your Worker
- **Priority:** `.env` > `wrangler.jsonc` → `vars` > System environment variables

**When `.env` is NOT Available (Production Deployment):**
- **`wrangler deploy`** → `.env` files are **NOT** deployed to Cloudflare
- `.env` doesn't exist in production, so `wrangler.jsonc` → `vars` is used
- **For production:** Set environment variables in `wrangler.jsonc` → `vars`

**Summary:**
- **Local (`wrangler dev`):** `.env` takes precedence → Use `.env` as single source of truth
- **Production (`wrangler deploy`):** `.env` doesn't exist → Use `wrangler.jsonc` → `vars`

**⚠️ Important: Worker vs Container Environment Variables**

There are two types of environment variables in Cloudflare Workers + Containers:

### 1. Worker Environment Variables (`vars`)

These are for the **Worker** (`index.js`) and are accessible via the `env` parameter:

```jsonc
{
  "vars": {
    "WORKER_VAR": "value"
  }
}
```

Access in Worker (`index.js`):
```javascript
export default {
  async fetch(request, env) {
    const value = env.WORKER_VAR; // Accessible here
  }
}
```

### 2. Container Environment Variables (`containers[].env`)

These are for the **Container** (`server.js`) and are accessible via `process.env`:

```jsonc
{
  "containers": [
    {
      "class_name": "MCPContainer",
      "image": "registry.cloudflare.com/.../hello3dmcp-server:latest",
      "env": {
        "BROWSER_URL": "https://hello3dmcp-frontend.netlify.app"
      }
    }
  ]
}
```

Access in Container (`server.js`):
```javascript
const BROWSER_URL = process.env.BROWSER_URL; // Accessible here
```

**Why the distinction?**
- The Worker and Container are **separate processes**
- Worker `vars` are **not** automatically available to the container
- To pass variables to the container, use `containers[].env` (not `vars`)

### Secrets

For sensitive data, use Wrangler secrets (these are available to Workers via `env`):

```bash
npx wrangler secret put API_TOKEN
```

**Note:** Secrets are for Workers. To pass secrets to containers, you may need to use a different approach or pass them through the Worker.

---

## 14. Production Notes & Caveats

### 1. Cloudflare Containers Beta Limitations

- Autoscaling is **manual**
- Instances may cold start after idle
- Cold starts can take several seconds

Use a periodic ping if necessary.

### 2. Port Behavior

Cloudflare Containers may expect a **single exposed port**.\
You may simplify deployment by merging HTTP + WebSocket into one port.

### 3. Logging

You can view container logs using Wrangler:

```bash
npx wrangler tail
```

### 4. Zero‑downtime updates

Redeploying the container will spin up a new instance before removing the old one.

---

## 15. Understanding the Architecture: Container vs Configuration

### What Gets Built vs What Gets Configured

**Container Image (Built from `Dockerfile`):**
```
Dockerfile → docker build → Container Image → Pushed to Registry
├── Node.js runtime
├── server.js (your MCP server code)
├── package.json dependencies
└── Build-time env vars (FORCE_HTTP_MODE=true)
```

**`wrangler.jsonc` (Configuration File):**
```
wrangler.jsonc → Used by Wrangler CLI → Configures Cloudflare Deployment
├── Which container image to use (containers[].image)
├── Worker configuration (index.js settings)
├── Durable Objects setup
├── Runtime env vars for container (containers[].env)
└── Routes, domains, account settings
```

### How They Work Together

1. **Build Phase:**
   - `Dockerfile` → Container image → Pushed to Cloudflare Registry
   - Image is stored at: `registry.cloudflare.com/<account-id>/hello3dmcp-server:latest`

2. **Configuration Phase:**
   - `wrangler.jsonc` tells Cloudflare:
     - "Use this container image: `registry.cloudflare.com/.../hello3dmcp-server:latest`"
     - "Run it with these environment variables: `BROWSER_URL=...`"
     - "Proxy traffic through this Worker: `index.js`"

3. **Deployment Phase:**
   - `npx wrangler deploy` reads `wrangler.jsonc`
   - Cloudflare pulls the container image from the registry
   - Cloudflare starts the container with env vars from `wrangler.jsonc`
   - Cloudflare deploys the Worker (`index.js`) that proxies to the container

### Key Points

- **Container image is built once** (when you push it)
- **`wrangler.jsonc` is read every time** you deploy or run `wrangler dev`
- **You can change `wrangler.jsonc` without rebuilding the container** (for env vars, routes, etc.)
- **You must rebuild the container** if you change `server.js` or dependencies

### Example Workflow

```bash
# 1. Build and push container (uses Dockerfile)
docker build --platform linux/amd64 -t hello3dmcp-server:latest .
npx wrangler containers push hello3dmcp-server:latest

# 2. Configure deployment (uses wrangler.jsonc)
# Edit wrangler.jsonc to set containers[].image and containers[].env

# 3. Deploy (reads wrangler.jsonc, pulls container from registry)
npx wrangler deploy

# 4. Change env vars? Just edit wrangler.jsonc and redeploy (no rebuild needed)
# 5. Change server.js? Rebuild container AND redeploy
```

---

## 15.1. When to Rebuild vs When to Redeploy: A Critical Distinction

**⚠️ This is one of the most confusing aspects of Cloudflare Containers. Understanding this will save you hours of frustration.**

### The Two Separate Pieces

Your deployment consists of **two completely separate pieces**:

1. **Container Image** (Docker)
   - Contains: `server.js` + all dependencies
   - Built from: `Dockerfile`
   - Stored in: Cloudflare Container Registry
   - Runs: Your actual MCP server application

2. **Worker Code** (`index.js`)
   - Contains: The proxy code that forwards requests to the container
   - Configured by: `wrangler.jsonc`
   - Runs: On Cloudflare's edge (NOT inside the container)
   - Deployed: Separately from the container

### When to Rebuild the Container

**You MUST rebuild and push the container image when you change:**

- ✅ `server.js` (your MCP server code)
- ✅ `package.json` (adding/removing dependencies)
- ✅ `Dockerfile` (changing container configuration)
- ✅ Any files that get copied into the container (via `COPY` in Dockerfile)
- ✅ Build-time environment variables (set in Dockerfile with `ENV`)

**Rebuild commands:**
```bash
# Option 1: Build and push in one step (recommended)
npx wrangler containers build . -t hello3dmcp-server:latest

# Option 2: Build locally, then push separately
docker build --platform linux/amd64 -t hello3dmcp-server:latest .
npx wrangler containers push hello3dmcp-server:latest
```

**After rebuilding:** You still need to redeploy the Worker (see below).

### When to Redeploy the Worker (No Container Rebuild Needed)

**You can just redeploy (no container rebuild) when you change:**

- ✅ `index.js` (Worker proxy code)
- ✅ `wrangler.jsonc` (configuration, environment variables, routes)
- ✅ Runtime environment variables (set in `wrangler.jsonc` → `vars` or `containers[].env`)

**Redeploy commands:**
```bash
# For local testing
npx wrangler dev

# For production deployment
npx wrangler deploy
```

**Important:** `wrangler dev` reads `index.js` directly from your local filesystem, so changes to `index.js` take effect immediately when you restart `wrangler dev` (no rebuild needed).

### Quick Reference Table

| What You Changed | Rebuild Container? | Redeploy Worker? | Notes |
|-----------------|-------------------|------------------|-------|
| `server.js` | ✅ **YES** | ✅ Yes | Container contains server.js |
| `package.json` | ✅ **YES** | ✅ Yes | Dependencies are installed in container |
| `Dockerfile` | ✅ **YES** | ✅ Yes | Container definition changed |
| `index.js` | ❌ No | ✅ **YES** | Worker code, not in container |
| `wrangler.jsonc` | ❌ No | ✅ **YES** | Configuration file, not in container |
| `wrangler.jsonc` → `vars.BROWSER_URL` | ❌ No | ✅ **YES** | Runtime env var, passed to container |
| `wrangler.jsonc` → `containers[].env` | ❌ No | ✅ **YES** | Runtime env var, passed to container |

### Common Scenarios

#### Scenario 1: You changed `index.js` (Worker code)
```bash
# NO container rebuild needed!
# Just restart wrangler dev or redeploy:
npx wrangler dev
# OR for production:
npx wrangler deploy
```

#### Scenario 2: You changed `server.js` (container code)
```bash
# YES, rebuild container:
npx wrangler containers build . -t hello3dmcp-server:latest

# Then redeploy Worker:
npx wrangler deploy
```

#### Scenario 3: You changed `BROWSER_URL` in `wrangler.jsonc`
```bash
# NO container rebuild needed!
# The env var is passed at runtime, not baked into the image
# Just redeploy:
npx wrangler deploy
# OR restart wrangler dev:
npx wrangler dev
```

#### Scenario 4: You added a new npm package
```bash
# YES, rebuild container (package.json changed):
npm install <package-name>
npx wrangler containers build . -t hello3dmcp-server:latest

# Then redeploy:
npx wrangler deploy
```

### Why This Confusion Exists

The confusion comes from the fact that:

1. **`index.js` is NOT in the container** - It's Worker code that runs on Cloudflare's edge
2. **`server.js` IS in the container** - It's your application code
3. **Environment variables can be set in two places:**
   - Build-time (in `Dockerfile` with `ENV`) → Requires rebuild
   - Runtime (in `wrangler.jsonc` with `vars` or `containers[].env`) → No rebuild needed

### How to Verify What's in Your Container

To see what's actually in your container image:
```bash
# Inspect the container image
docker inspect hello3dmcp-server:latest

# Or run it and check the filesystem
docker run --rm -it hello3dmcp-server:latest sh
# Inside the container:
ls -la
cat server.js  # This file IS in the container
cat index.js  # This file is NOT in the container (it's Worker code)
```

### Summary

**Remember:**
- **Container = `server.js` + dependencies** (built from Dockerfile)
- **Worker = `index.js`** (deployed separately)
- **If you're not sure:** Ask yourself "Is this file copied into the container by the Dockerfile?" If yes → rebuild. If no → just redeploy.

---

## 16. Summary of Commands

```bash
# Install dependencies (including @cloudflare/containers)
npm install

# Build Docker image locally (CRITICAL: use --platform flag for Cloudflare)
docker build --platform linux/amd64 -t hello3dmcp-server:latest .

# Test Docker container locally (default mode - Cloudflare compatible)
docker run -p 3000:3000 hello3dmcp-server:latest
# Endpoints: http://localhost:3000/mcp and ws://localhost:3000/ws

# Test Docker container locally (legacy mode - separate WebSocket port)
docker run -p 3000:3000 -p 3001:3001 -e USE_SEPARATE_WS_PORT=true hello3dmcp-server:latest
# Endpoints: http://localhost:3000/mcp and ws://localhost:3001

# Push to Cloudflare Container Registry
npx wrangler containers build . -p -t hello3dmcp-server:latest

# Test locally with Wrangler (Worker + Container) - RECOMMENDED for Cloudflare testing
npx wrangler dev
# Endpoints: http://localhost:8787/mcp and ws://localhost:8787/ws

# Clear Wrangler cache (if needed)
rm -rf .wrangler

# Deploy to Cloudflare
npx wrangler deploy

# View logs
npx wrangler tail
```

**Testing with MCP Inspector:**

```bash
# With wrangler dev (port 8787 - Worker proxy)
npx @modelcontextprotocol/inspector --transport http --server-url http://localhost:8787/mcp

# With direct Docker - default mode (port 3000)
npx @modelcontextprotocol/inspector --transport http --server-url http://localhost:3000/mcp

# With direct Docker - legacy mode (port 3000 for HTTP, 3001 for WebSocket)
# Note: MCP Inspector connects to HTTP endpoint, WebSocket is separate
npx @modelcontextprotocol/inspector --transport http --server-url http://localhost:3000/mcp
```

**Port Reference:**

**Local Development:**
- **Wrangler Dev:** Port 8787 (Worker proxy) - Use for testing Cloudflare setup
- **Docker Default:** Port 3000 (HTTP + WebSocket) - Use for server debugging
- **Docker Legacy:** Port 3000 (HTTP) + Port 3001 (WebSocket) - Only if needed for backward compatibility

**Production:**
- **No ports in URLs** - Use domain names instead
- **Container:** Port 3000 internally (handled by Cloudflare)
- **Worker:** Routes traffic via domain patterns (no ports)
- **URLs:** `https://yourdomain.com/mcp` and `wss://yourdomain.com/ws`

---

## 16. Project Structure

After completing the setup, your project should have:

```
hello3dmcp-server/
├── Dockerfile                 # Container definition
├── index.js                   # Worker proxy (forwards to container)
├── server.js                  # Main MCP server
├── wrangler.jsonc             # Cloudflare configuration
├── package.json               # Dependencies (including @cloudflare/containers)
├── .gitignore                # Should include .wrangler/
└── docs/
    └── cloudflare_container_deployment.md  # This document
```

**Key files:**
- `Dockerfile`: Defines the container image
- `index.js`: Worker that proxies requests to the container
- `wrangler.jsonc`: Cloudflare configuration (account, containers, durable objects, migrations)
- `server.js`: Your MCP server (automatically detects container mode)

---

## 17. Optional: Provide a Deployment Skeleton Repo

If your team prefers a ready-to-deploy boilerplate structure, you can generate a skeleton repository with:

- Dockerfile
- Worker proxy (`index.js`)
- Example `wrangler.toml`
- Setup instructions

Let me know and I can generate that for you.

---

## End

You now have a complete guide for deploying `hello3dmcp-server` onto Cloudflare Containers with Worker proxying, environment management, and local dev support.

