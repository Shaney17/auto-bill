FROM node:20-slim

RUN apt-get update && apt-get install -y curl python3 && \
    curl -LsSf https://astral.sh/uv/install.sh | sh && \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.local/bin:$PATH"

# Pre-install minimax MCP at build time to avoid runtime downloads
RUN uv tool install minimax-coding-plan-mcp

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
