# Docker & MCP Inspector Cheat Sheet

Quick reference for Docker container management and MCP Inspector testing.

---

## 🐳 Docker Commands

### Building the Image

```bash
# Build the Docker image
docker build -t hello3dmcp-server:latest .

# Build with no cache (force fresh build)
docker build --no-cache -t hello3dmcp-server:latest .
```

### Running Containers

```bash
# Run container in foreground (see logs directly)
docker run -p 3000:3000 -p 3001:3001 hello3dmcp-server:latest

# Run container in background (detached mode)
docker run -d -p 3000:3000 -p 3001:3001 --name hello3dmcp-test hello3dmcp-server:latest

# Run with custom environment variables
docker run -d -p 3000:3000 -p 3001:3001 \
  -e BROWSER_URL=https://your-frontend.netlify.app \
  -e MCP_PORT=3000 \
  --name hello3dmcp-test \
  hello3dmcp-server:latest
```

### Container Management

```bash
# List running containers
docker ps

# List all containers (including stopped)
docker ps -a

# List containers running your image
docker ps --filter "ancestor=hello3dmcp-server:latest"

# Stop a container
docker stop hello3dmcp-test

# Start a stopped container
docker start hello3dmcp-test

# Restart a container
docker restart hello3dmcp-test

# Remove a stopped container
docker rm hello3dmcp-test

# Stop and remove in one command
docker rm -f hello3dmcp-test

# Stop all containers running your image
docker ps -q --filter "ancestor=hello3dmcp-server:latest" | xargs docker stop
```

### Viewing Logs

```bash
# View container logs
docker logs hello3dmcp-test

# Follow logs in real-time
docker logs -f hello3dmcp-test

# View last N lines
docker logs --tail 50 hello3dmcp-test

# View logs with timestamps
docker logs -t hello3dmcp-test
```

### Container Inspection

```bash
# Inspect container details
docker inspect hello3dmcp-test

# View container resource usage
docker stats hello3dmcp-test

# Execute command in running container
docker exec -it hello3dmcp-test sh

# View container port mappings
docker port hello3dmcp-test
```

### Image Management

```bash
# List images
docker images

# Remove an image
docker rmi hello3dmcp-server:latest

# Remove unused images
docker image prune

# Remove all unused resources
docker system prune
```

---

## 🔍 MCP Inspector Commands

### Starting the Inspector

```bash
# Basic usage (auto-detects transport)
npx @modelcontextprotocol/inspector http://localhost:3000/mcp

# Explicitly specify Streamable HTTP transport
npx @modelcontextprotocol/inspector --transport http --server-url http://localhost:3000/mcp

# With custom headers (if needed)
npx @modelcontextprotocol/inspector \
  --transport http \
  --server-url http://localhost:3000/mcp \
  --header "Authorization: Bearer token123"
```

### Inspector Configuration

**In the Inspector UI:**
- **Transport Type:** Select **"Streamable HTTP"** (not SSE)
- **URL:** `http://localhost:3000/mcp`
- **Connection Type:** Select **"Direct"**
- Click **"Connect"**

**Note:** The CLI flag `--transport sse` may be a legacy alias. Always use **"Streamable HTTP"** in the UI, which matches your server's `StreamableHTTPServerTransport`.

---

## 🧪 Testing & Verification

### Test Server Endpoint

```bash
# Test MCP endpoint (should return error about Accept headers - that's OK)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: test-session" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# Check if server is responding
curl -I http://localhost:3000/mcp
```

### Check Port Availability

```bash
# Check if port 3000 is in use
lsof -i :3000

# Check if port 3001 is in use
lsof -i :3001

# Kill process on port 3000 (if needed)
lsof -ti :3000 | xargs kill
```

### Verify Container Status

```bash
# Check container is running
docker ps --filter "name=hello3dmcp"

# Verify logs show HTTP mode
docker logs hello3dmcp-test | grep "HTTP/SSE mode"

# Verify server is listening
docker logs hello3dmcp-test | grep "listening"
```

---

## 🚀 Common Workflows

### Full Development Cycle

```bash
# 1. Build the image
docker build -t hello3dmcp-server:latest .

# 2. Stop any existing containers
docker ps -q --filter "ancestor=hello3dmcp-server:latest" | xargs -r docker stop

# 3. Remove old containers
docker ps -aq --filter "ancestor=hello3dmcp-server:latest" | xargs -r docker rm

# 4. Run new container
docker run -d -p 3000:3000 -p 3001:3001 --name hello3dmcp-test hello3dmcp-server:latest

# 5. Check logs
docker logs -f hello3dmcp-test

# 6. In another terminal, start Inspector
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

### Quick Restart

```bash
# Stop and restart container
docker restart hello3dmcp-test

# Or stop and start fresh
docker stop hello3dmcp-test
docker start hello3dmcp-test
```

### Clean Slate

```bash
# Stop all containers
docker ps -q --filter "ancestor=hello3dmcp-server:latest" | xargs -r docker stop

# Remove all containers
docker ps -aq --filter "ancestor=hello3dmcp-server:latest" | xargs -r docker rm

# Remove image (optional)
docker rmi hello3dmcp-server:latest
```

---

## 📝 Important Notes

### Transport Types

- **STDIO Mode:** Only for local subprocess execution (Claude Desktop)
- **HTTP/SSE Mode:** For network deployment (Docker, Cloudflare)
- **Streamable HTTP:** The correct MCP transport (uses SSE internally)

### Ports

- **Port 3000:** MCP HTTP endpoint (`/mcp`)
- **Port 3001:** WebSocket server for browser clients

### Environment Variables

The Dockerfile sets `FORCE_HTTP_MODE=true` to ensure HTTP mode in containers. You can override with:

```bash
docker run -d -p 3000:3000 -p 3001:3001 \
  -e FORCE_HTTP_MODE=true \
  -e BROWSER_URL=https://your-frontend.netlify.app \
  hello3dmcp-server:latest
```

---

## 🔗 Related Documentation

- [Cloudflare Container Deployment Guide](./cloudflare_container_deployment.md)
- [README.md](../README.md) - Main project documentation
- [MCP Inspector Setup](../README.md#mcp-inspector) - Detailed Inspector instructions

---

**Last Updated:** 2025-01-XX

