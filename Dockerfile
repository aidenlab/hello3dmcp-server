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
