FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --silent

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

EXPOSE 3001 3009

ENV MCP_HTTP_PORT=3001
ENV TEST_SUPPORT_PORT=3009

CMD ["node", "dist/http-server.js"]
