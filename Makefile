# guidance-is-not-policy — Makefile
#
# Usage:
#   make up          start the full Docker stack
#   make down        stop the stack
#   make logs        follow live logs (all containers)
#   make session     initialize an MCP session (run once after make up)
#   make step1       HIDDEN: gateway hides production_admin
#   make step2       ALLOWED: staging deploy succeeds
#   make step3       DENY: same tool, production blocked
#   make step4       DENY: production_admin direct call blocked
#   make step5       backend log — what actually reached the server
#   make step6       FAIL CLOSED: stop policy, verify nothing forwards
#   make demo        run all steps in sequence
#   make test        run contract tests against running stack

.PHONY: up down logs session step1 step2 step3 step4 step5 step6 demo test clean

# ---------------------------------------------------------------------------
# Stack management
# ---------------------------------------------------------------------------

up:
	docker compose up --build -d
	@echo ""
	@echo "Waiting for containers..."
	@sleep 8
	@docker compose ps

down:
	docker compose down

logs:
	docker compose logs -f

# ---------------------------------------------------------------------------
# Session initialization
# Run once after make up. Saves session ID to /tmp/mcp_sid.sh
# ---------------------------------------------------------------------------

session:
	@echo "Initializing MCP session through agentgateway..."
	@curl -si "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"lab-agent","version":"1.0.0"}}}' \
	  > /tmp/mcp_raw.txt 2>&1
	@SID=$$(grep -i "^mcp-session-id:" /tmp/mcp_raw.txt | awk '{print $$2}' | tr -d '\r\n'); \
	  if [ -z "$$SID" ]; then \
	    echo "ERROR: No session ID. Is the stack running? Try: make up"; \
	    cat /tmp/mcp_raw.txt; \
	    exit 1; \
	  fi; \
	  echo "export SID=$$SID" > /tmp/mcp_sid.sh; \
	  echo "Session ID saved."; \
	  echo ""; \
	  echo "Completing handshake..."; \
	  curl -s "http://localhost:3000/mcp" \
	    -H "Content-Type: application/json" \
	    -H "Accept: application/json, text/event-stream" \
	    -H "MCP-Protocol-Version: 2025-03-26" \
	    -H "mcp-session-id: $$SID" \
	    -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' > /dev/null; \
	  echo "Ready. Run: make step1"

# ---------------------------------------------------------------------------
# Demo steps — run in order after make session
# ---------------------------------------------------------------------------

step1:
	@echo ""
	@echo "========================================"
	@echo "STEP 1 — HIDDEN"
	@echo "Backend has 3 tools. Gateway shows 2."
	@echo "production_admin is filtered from discovery."
	@echo "========================================"
	@echo ""
	@echo "--- Backend (direct, no gateway) ---"
	@curl -s http://localhost:3001/health
	@echo ""
	@echo ""
	@echo "--- Gateway (agent sees this) ---"
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
	@echo ""

step2:
	@echo ""
	@echo "========================================"
	@echo "STEP 2 — ALLOWED"
	@echo "deploy(staging) succeeds end to end."
	@echo "========================================"
	@echo ""
	@curl -s -X DELETE http://localhost:3001/test/log > /dev/null
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"staging","version":"1.2.0"}}}'
	@echo ""

step3:
	@echo ""
	@echo "========================================"
	@echo "STEP 3 — ARG-SENSITIVE DENY"
	@echo "Same tool name. Production blocked."
	@echo "Watch logs: make logs"
	@echo "========================================"
	@echo ""
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"production","version":"1.2.0"}}}'
	@echo ""

step4:
	@echo ""
	@echo "========================================"
	@echo "STEP 4 — DENIED"
	@echo "production_admin called directly."
	@echo "Hidden from discovery AND denied at call time."
	@echo "========================================"
	@echo ""
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"production_admin","arguments":{"operation":"restart","target":"api-service"}}}'
	@echo ""

step5:
	@echo ""
	@echo "========================================"
	@echo "STEP 5 — BACKEND LOG"
	@echo "Proof of what actually reached the server."
	@echo "Only staging deploy should appear."
	@echo "========================================"
	@echo ""
	@curl -s http://localhost:3001/test/log
	@echo ""

step6:
	@echo ""
	@echo "========================================"
	@echo "STEP 6 — FAIL CLOSED"
	@echo "Policy processor stopped."
	@echo "Even staging is now blocked."
	@echo "========================================"
	@echo ""
	@echo "Stopping policy processor..."
	@docker stop guidance-policy > /dev/null
	@sleep 3
	@echo "Policy: STOPPED"
	@echo ""
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"staging","version":"1.2.0"}}}'
	@echo ""
	@echo "Restarting policy processor..."
	@docker start guidance-policy > /dev/null
	@sleep 3
	@echo "Policy: RUNNING"
	@curl -s http://localhost:3002/health
	@echo ""

# ---------------------------------------------------------------------------
# Run all steps in sequence
# ---------------------------------------------------------------------------

demo: step1 step2 step3 step4 step5 step6

# ---------------------------------------------------------------------------
# Contract tests
# ---------------------------------------------------------------------------

test:
	@echo "Running contract tests against live stack..."
	@cd contract-tests && \
	  GATEWAY_URL=http://localhost:3000 \
	  MCP_SERVER_URL=http://localhost:3001 \
	  POLICY_URL=http://localhost:3002 \
	  npm test

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

clean:
	rm -f /tmp/mcp_sid.sh /tmp/mcp_raw.txt
	docker compose down
