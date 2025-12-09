export default {
  async fetch(request, env) {
    // Forward the incoming request to the container
    const response = await env.MCP_CONTAINER.fetch(request);
    return response;
  }
};

