FROM node:22-alpine

# WORKDIR matches the expected directory structure:
# /app/extmcp-policy/dist/policy.js  (compiled output)
# /app/ext_mcp.proto                 (proto file, one level up from extmcp-policy/)
#
# When dist/policy.js runs, __dirname = /app/extmcp-policy/dist/
# isCompiledDist = true → proto resolved at /app/ext_mcp.proto ✓

WORKDIR /app/extmcp-policy

# Copy proto to /app/ (one level above WORKDIR)
COPY ext_mcp.proto /app/ext_mcp.proto

COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci --silent

COPY policy.ts ./
COPY policy.test.ts ./

RUN npm run build

EXPOSE 9001 3002

ENV POLICY_GRPC_PORT=9001
ENV POLICY_HTTP_PORT=3002
ENV FAILURE_MODE=failClosed

CMD ["node", "dist/policy.js"]
