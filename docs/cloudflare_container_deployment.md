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

**Before starting:** Make sure Docker Desktop is running. If you get an error like "Cannot connect to the Docker daemon", start Docker Desktop and wait for it to fully initialize.

From the project root:

```bash
docker build -t hello3dmcp-server:latest .
```

Test it locally:

**Basic test (uses default browser URL):**
```bash
docker run -p 3000:3000 -p 3001:3001 hello3dmcp-server:latest
```

**Test with Netlify-hosted frontend:**
```bash
docker run -p 3000:3000 -p 3001:3001 \
  -e BROWSER_URL=https://hello3dmcp-frontend.netlify.app \
  hello3dmcp-server:latest
```

**Test with local frontend (e.g., Vite dev server on port 5173):**
```bash
docker run -p 3000:3000 -p 3001:3001 \
  -e BROWSER_URL=http://localhost:5173 \
  hello3dmcp-server:latest
```

**Note:** Use the `-e BROWSER_URL` environment variable to configure which frontend the server should connect to. This is especially useful when testing with MCP Inspector - you can switch between your local development frontend and the Netlify-hosted production frontend.

Confirm the server is accessible at:

- `http://localhost:3000/mcp`
- WebSocket at `ws://localhost:3001`

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

**Note:** 
- The `.` specifies the current directory (where your Dockerfile is located)
- The `-p` flag automatically pushes the image to Cloudflare's registry after building
- The command should be run from your project root directory

Wrangler outputs a registry URI similar to:

```
registry.cloudflare.com/<account-id>/hello3dmcp-server:latest
```

**Save this registry URI** - you'll need it in the next step for your `wrangler.toml` configuration.

**⚠️ Important:** After completing step 5, make sure to update the `containers.image` field in your `wrangler.jsonc` (or `wrangler.toml`) file with the actual registry URI you received. Replace the placeholder `<account-id>` with your actual account ID, or use the full registry URI exactly as shown in the output.

**Alternative:** If you prefer to build and push separately:

```bash
# Build only
npx wrangler containers build . -t hello3dmcp-server:latest

# Push separately
npx wrangler containers push hello3dmcp-server:latest
```

---

## 6. Create `wrangler.toml` (or `wrangler.jsonc`)

**Important:** You should have a basic `wrangler.jsonc` or `wrangler.toml` file for authentication (step 5), but **do NOT add the `containers` section until AFTER you've completed step 5** (pushed the container to the registry).

If you don't have a `wrangler.jsonc` or `wrangler.toml` file yet, create a basic one:

```jsonc
{
  "name": "hello3dmcp-cloudflare",
  "main": "index.js",
  "compatibility_date": "2024-12-01",
  "account_id": "your-account-id-here"
}
```

**After completing step 5** (after pushing the container), update your `wrangler.toml` or `wrangler.jsonc` to include the containers configuration:

```toml
name = "hello3dmcp-cloudflare"
compatibility_date = "2025-12-07"

[containers]
image = "registry.cloudflare.com/<account-id>/hello3dmcp-server:latest"
```

**⚠️ Important:** Replace `<account-id>` in the `image` field with your actual account ID from step 5, or use the full registry URI exactly as shown in the Wrangler output. For example, if your account ID is `c4d518f1bd8e042051183bcc1ca58d10`, the image should be:
```
image = "registry.cloudflare.com/c4d518f1bd8e042051183bcc1ca58d10/hello3dmcp-server:latest"
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

