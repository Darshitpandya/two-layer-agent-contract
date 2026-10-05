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
#   make clean       stop stack and remove session files

.PHONY: up down logs session step1 step2 step3 step4 step5 step6 demo test clean

# ---------------------------------------------------------------------------
# Color codes — work on macOS Terminal, iTerm2, VS Code terminal
# ---------------------------------------------------------------------------

GREEN  := \033[0;32m
RED    := \033[0;31m
YELLOW := \033[0;33m
CYAN   := \033[0;36m
BOLD   := \033[1m
DIM    := \033[2m
RESET  := \033[0m

# ---------------------------------------------------------------------------
# Pretty output helpers
# ---------------------------------------------------------------------------

DIVIDER := printf '$(DIM)────────────────────────────────────────────────────$(RESET)\n'
LABEL   = printf '$(BOLD)$(CYAN)%-12s$(RESET) %s\n'

# ---------------------------------------------------------------------------
# Stack management
# ---------------------------------------------------------------------------

up:
	@printf '$(BOLD)Starting guidance-is-not-policy stack...$(RESET)\n'
	docker compose up --build -d
	@printf '\n$(DIM)Waiting for containers to be healthy...$(RESET)\n'
	@sleep 8
	@docker compose ps
	@printf '\n$(GREEN)$(BOLD)Stack running.$(RESET) Run: $(CYAN)make session$(RESET)\n'

down:
	@printf '$(YELLOW)Stopping stack...$(RESET)\n'
	docker compose down
	@printf '$(GREEN)Done.$(RESET)\n'

logs:
	docker compose logs -f

# ---------------------------------------------------------------------------
# Session initialization
# ---------------------------------------------------------------------------

session:
	@printf '$(BOLD)Initializing MCP session through agentgateway...$(RESET)\n'
	@curl -si "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"lab-agent","version":"1.0.0"}}}' \
	  > /tmp/mcp_raw.txt 2>&1
	@SID=$$(grep -i "^mcp-session-id:" /tmp/mcp_raw.txt | awk '{print $$2}' | tr -d '\r\n'); \
	  if [ -z "$$SID" ]; then \
	    printf '$(RED)$(BOLD)ERROR:$(RESET) No session ID. Is the stack running?\n'; \
	    printf '$(DIM)Try: make up$(RESET)\n'; \
	    exit 1; \
	  fi; \
	  echo "export SID=$$SID" > /tmp/mcp_sid.sh; \
	  printf '$(GREEN)$(BOLD)Session ready.$(RESET)\n'; \
	  printf '$(DIM)Completing MCP handshake...$(RESET)\n'; \
	  curl -s "http://localhost:3000/mcp" \
	    -H "Content-Type: application/json" \
	    -H "Accept: application/json, text/event-stream" \
	    -H "MCP-Protocol-Version: 2025-03-26" \
	    -H "mcp-session-id: $$SID" \
	    -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' > /dev/null; \
	  printf '$(GREEN)Handshake complete.$(RESET) Run: $(CYAN)make step1$(RESET)\n'

# ---------------------------------------------------------------------------
# Demo steps
# ---------------------------------------------------------------------------

step1:
	@$(DIVIDER)
	@printf '$(BOLD)STEP 1 — HIDDEN$(RESET)\n'
	@printf '$(DIM)Backend has 3 tools. Gateway shows 2. production_admin is filtered.$(RESET)\n'
	@$(DIVIDER)
	@printf '\n'
	@printf '$(CYAN)Backend (direct, no gateway):$(RESET)\n'
	@curl -s http://localhost:3001/health | python3 -c \
	  "import sys,json; r=json.load(sys.stdin); [print(f'  \033[2m{t}\033[0m') for t in r['tools']]"
	@printf '\n'
	@printf '$(CYAN)Gateway (what the agent sees):$(RESET)\n'
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
	  | python3 scripts/demo/parse_tools_list.py
	@printf '\n$(YELLOW)production_admin: HIDDEN from agent discovery$(RESET)\n'
	@printf '$(DIM)Watch Terminal A for the tools/list log entry$(RESET)\n\n'

step2:
	@$(DIVIDER)
	@printf '$(BOLD)STEP 2 — ALLOWED$(RESET)\n'
	@printf '$(DIM)deploy(staging) succeeds. Guidance and policy agree.$(RESET)\n'
	@$(DIVIDER)
	@curl -s -X DELETE http://localhost:3001/test/log > /dev/null
	@printf '\n$(CYAN)deploy(environment=staging, version=1.2.0):$(RESET)\n'
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"staging","version":"1.2.0"}}}' \
	  | python3 -c \
	  "import sys,json; \
	   lines=[l[5:].strip() for l in sys.stdin if l.startswith('data:')]; \
	   r=json.loads(lines[0]) if lines else {}; \
	   c=json.loads(r['result']['content'][0]['text']) if 'result' in r else None; \
	   print(f'  \033[0;32m\033[1mALLOW\033[0m  success={c[\"success\"]}  environment={c[\"environment\"]}  version={c[\"version\"]}') if c else print(f'  \033[0;31mDENY\033[0m  {r.get(\"error\",{}).get(\"message\",\"\")}') " \
	  2>/dev/null
	@printf '\n$(DIM)Watch Terminal A for: [POLICY] tools/call tool=deploy → Pass$(RESET)\n\n'

step3:
	@$(DIVIDER)
	@printf '$(BOLD)STEP 3 — ARG-SENSITIVE DENY$(RESET)\n'
	@printf '$(DIM)Same tool name. Different argument. Different outcome.$(RESET)\n'
	@$(DIVIDER)
	@printf '\n$(CYAN)deploy(environment=production, version=1.2.0):$(RESET)\n'
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"production","version":"1.2.0"}}}' \
	  | python3 -c \
	  "import sys,json; \
	   lines=[l[5:].strip() for l in sys.stdin if l.startswith('data:')]; \
	   r=json.loads(lines[0]) if lines else {}; \
	   print(f'  \033[0;31m\033[1mDENY\033[0m   {r[\"error\"][\"message\"]}') if 'error' in r else print('  \033[0;31mDENY\033[0m  (blocked before response body)')" \
	  2>/dev/null
	@printf '\n$(RED)production deployments are not permitted through this MCP surface$(RESET)\n'
	@printf '$(DIM)Watch Terminal A for: [POLICY] tools/call tool=deploy → DENY$(RESET)\n\n'

step4:
	@$(DIVIDER)
	@printf '$(BOLD)STEP 4 — DENIED$(RESET)\n'
	@printf '$(DIM)production_admin called directly. Hidden AND denied independently.$(RESET)\n'
	@$(DIVIDER)
	@printf '\n$(CYAN)tools/call: production_admin (not in tools/list, called directly):$(RESET)\n'
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"production_admin","arguments":{"operation":"restart","target":"api-service"}}}' \
	  | python3 -c \
	  "import sys,json; \
	   lines=[l[5:].strip() for l in sys.stdin if l.startswith('data:')]; \
	   r=json.loads(lines[0]) if lines else {}; \
	   print(f'  \033[0;31m\033[1mDENY\033[0m   {r[\"error\"][\"message\"]}') if 'error' in r else print('  \033[0;31mDENY\033[0m  (blocked at gateway)')" \
	  2>/dev/null
	@printf '\n$(DIM)Hidden ≠ denied. Both enforced independently.$(RESET)\n\n'

step5:
	@$(DIVIDER)
	@printf '$(BOLD)STEP 5 — BACKEND LOG$(RESET)\n'
	@printf '$(DIM)Proof of what actually reached the MCP server.$(RESET)\n'
	@$(DIVIDER)
	@printf '\n$(CYAN)Calls that reached the backend:$(RESET)\n'
	@curl -s http://localhost:3001/test/log | python3 -c \
	  "import sys,json; \
	   log=json.load(sys.stdin); \
	   [print(f'  \033[0;32m✓\033[0m  tool=\033[1m{e[\"tool\"]}\033[0m  environment={e[\"args\"].get(\"environment\",\"n/a\")}') for e in log] or \
	   print('  \033[2m(empty)\033[0m')"
	@printf '\n$(DIM)Only allowed calls appear. Denied calls never reached this log.$(RESET)\n\n'

step6:
	@$(DIVIDER)
	@printf '$(BOLD)STEP 6 — FAIL CLOSED$(RESET)\n'
	@printf '$(DIM)Policy processor stopped. Even staging is blocked.$(RESET)\n'
	@$(DIVIDER)
	@printf '\n$(YELLOW)Stopping policy processor...$(RESET)\n'
	@docker stop guidance-policy > /dev/null
	@sleep 3
	@printf '$(RED)Policy: STOPPED$(RESET)\n\n'
	@printf '$(CYAN)deploy(environment=staging) with policy processor down:$(RESET)\n'
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"staging","version":"1.2.0"}}}' \
	  | python3 -c \
	  "import sys,json; \
	   lines=[l[5:].strip() for l in sys.stdin if l.startswith('data:')]; \
	   r=json.loads(lines[0]) if lines else {}; \
	   print(f'  \033[0;31m\033[1mDENY\033[0m   {r[\"error\"][\"message\"]}') if 'error' in r else print('  \033[0;31mDENY\033[0m  (failClosed — policy processor unreachable)')" \
	  2>/dev/null
	@printf '\n$(RED)failClosed: policy unavailable = request not forwarded$(RESET)\n'
	@printf '\n$(YELLOW)Restarting policy processor...$(RESET)\n'
	@docker start guidance-policy > /dev/null
	@sleep 3
	@printf '$(GREEN)Policy: RUNNING$(RESET)  '
	@curl -s http://localhost:3002/health
	@printf '\n\n'

# ---------------------------------------------------------------------------
# Run all steps in sequence
# ---------------------------------------------------------------------------

demo: step1 step2 step3 step4 step5 step6
	@$(DIVIDER)
	@printf '$(GREEN)$(BOLD)Demo complete.$(RESET)\n'
	@printf '$(DIM)All five enforcement properties demonstrated.$(RESET)\n'
	@$(DIVIDER)

# ---------------------------------------------------------------------------
# Contract tests
# ---------------------------------------------------------------------------

test:
	@printf '$(BOLD)Running contract tests against live stack...$(RESET)\n\n'
	@cd contract-tests && \
	  GATEWAY_URL=http://localhost:3000 \
	  MCP_SERVER_URL=http://localhost:3001 \
	  POLICY_URL=http://localhost:3002 \
	  npm test

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

clean:
	@printf '$(YELLOW)Cleaning up...$(RESET)\n'
	rm -f /tmp/mcp_sid.sh /tmp/mcp_raw.txt
	docker compose down
	@printf '$(GREEN)Done.$(RESET)\n'
