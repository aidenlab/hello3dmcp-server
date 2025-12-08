# Deploying `hello3dmcp-server` to Cloudflare Containers

This document provides a practical, developer-friendly guide for deploying the [`hello3dmcp-server`](https://github.com/aidenlab/hello3dmcp-server) project to **Cloudflare Containers**. It covers containerization, registry pushes, Worker proxying, local testing, and production considerations.

Cloudflare Containers is currently a **beta** platform designed for running real Docker images at Cloudflare's edge. This allows you to deploy full Node.js services (including WebSockets) with global reach.

---

## 1. Overview

`hello3dmcp-server` is a Node.js MCP + WebSocket server that exposes:

- An HTTP MCP endpoint (default: port **3000**)
- A WebSocket server for real‑time 3D client communication (default: port **3001**)

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
- **Wrangler CLI** (`npm i -g wrangler` or npx)
- A **Cloudflare account** with access to the Containers beta

---

## 3. Add a Dockerfile to the Project

Create a file named `Dockerfile` at the root of the repository. Example:

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

CMD ["node", "server.js"]
```

This builds the production server with only necessary files and exposes the ports used by MCP and WebSocket.

---

## 4. Build the Container Locally

From the project root:

```bash
docker build -t hello3dmcp-server:latest .
```

Test it locally:

```bash
docker run -p 3000:3000 -p 3001:3001 hello3dmcp-server:latest
```

Confirm the server is accessible at:

- `http://localhost:3000/mcp`
- WebSocket at `ws://localhost:3001`

---

## 5. Push to Cloudflare Container Registry

Use Wrangler to build and push the container:

```bash
npx wrangler containers build -p -t hello3dmcp-server:latest
```

Wrangler outputs a registry URI similar to:

```
registry.cloudflare.com/<account-id>/hello3dmcp-server:latest
```

Alternatively, you may push manually using Docker after authenticating.

---

## 6. Create `wrangler.toml`

In the project root, create a file named ``.

```toml
name = "hello3dmcp-cloudflare"
compatibility_date = "2025-12-07"

[containers]
image = "registry.cloudflare.com/<account-id>/hello3dmcp-server:latest"
```

This tells Cloudflare which container image to deploy.

However, this alone does *not* expose the service. For that, we create a Worker.

---

## 7. Add a Worker to Proxy Requests to the Container

Because containers are not publicly reachable directly, we create a Worker that forwards traffic.

Create a file named ``:

```js
export default {
  async fetch(request, env) {
    // Forward the incoming request to the container
    const response = await env.MCP_CONTAINER.fetch(request);
    return response;
  }
};
```

Update `wrangler.toml` to bind the container:

```toml
name = "hello3dmcp-cloudflare"
main = "index.js"
compatibility_date = "2025-12-07"

[containers]
image = "registry.cloudflare.com/<account-id>/hello3dmcp-server:latest"

[[bindings]]
type = "container"
name = "MCP_CONTAINER"
```

This Worker now acts as a public HTTP/WebSocket entrypoint to your container.

---

## 8. WebSocket Support

Because your app uses WebSockets on port 3001, you may need to:

1. Expose WebSockets from the container on the same port as HTTP, **or**
2. Use Cloudflare's WebSocket-compatible container fetch API

The simplest approach is to update your Node server to serve both HTTP and WebSocket on the **same port**.

If you do not, Cloudflare may not expose both ports.

---

## 9. Local Testing with Wrangler

You can test Workers + Containers locally:

```bash
npx wrangler dev
```

This uses your local Docker runtime to run the container.

Verify:

- `/mcp` HTTP requests succeed
- WebSocket connections work through the Worker

---

## 10. Deploy to Cloudflare

When ready:

```bash
npx wrangler deploy
```

This deploys:

- Your worker (public)
- Your container (private, globally available)

The output will contain a public URL, for example:

```
https://hello3dmcp-cloudflare.<your-domain>.workers.dev
```

Point your front-end or MCP client to this URL.

---

## 11. Environment Variables

You can add environment variables to `wrangler.toml`:

```toml
[vars]
BROWSER_URL = "https://your-frontend.example.com"
MCP_PORT = "3000"
```

Or store secrets:

```bash
npx wrangler secret put API_TOKEN
```

---

## 12. Production Notes & Caveats

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

## 13. Summary of Commands

```bash
# Build locally
docker build -t hello3dmcp-server:latest .

# Push to Cloudflare using Wrangler
npx wrangler containers build -p -t hello3dmcp-server:latest

# Local development
npx wrangler dev

# Deploy globally
npx wrangler deploy
```

---

## 14. Optional: Provide a Deployment Skeleton Repo

If your team prefers a ready-to-deploy boilerplate structure, you can generate a skeleton repository with:

- Dockerfile
- Worker proxy (`index.js`)
- Example `wrangler.toml`
- Setup instructions

Let me know and I can generate that for you.

---

## End

You now have a complete guide for deploying `hello3dmcp-server` onto Cloudflare Containers with Worker proxying, environment management, and local dev support.

