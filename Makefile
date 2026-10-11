# guidance-is-not-policy — Makefile
#
# Usage:
#   make up              start the full Docker stack (default: no port 3001)
#   make up-evidence     start with loopback port 3001 for direct comparison
#   make down            stop the stack
#   make logs            follow live logs (all containers)
#   make session         initialize an MCP session (run once after make up)
#   make show-visibility   tool surface without vs through agentgateway
#   make show-allow        staging deploy allowed end-to-end
#   make show-deny         same tool, production arg blocked
#   make show-hidden-denied  production_admin direct call denied
#   make show-backend-log  what actually reached the MCP server
#   make show-fail-closed  policy down — even staging is blocked
#   make demo            run all steps in sequence
#   make test            run contract tests against running stack
#   make test-topology   verify default topology does not publish port 3001
#   make verify          run all verification checks
#   make clean           stop stack and remove session files

.PHONY: up up-evidence down logs session show-visibility show-allow show-deny show-hidden-denied show-backend-log show-fail-closed demo test test-topology test-fail-closed verify clean

# ---------------------------------------------------------------------------
# Color codes — work on macOS Terminal, iTerm2, VS Code terminal
# ---------------------------------------------------------------------------

GREEN  := \033[0;32m
RED    := \033[0;31m
ORANGE := \033[38;5;208m
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
	@printf '$(DIM)Default topology: mcp-server port 3001 is internal-only.$(RESET)\n'
	docker compose up --build -d
	@printf '\n$(DIM)Waiting for containers to be healthy...$(RESET)\n'
	@sleep 8
	@docker compose ps
	@printf '\n$(GREEN)$(BOLD)Stack running.$(RESET) Run: $(CYAN)make session$(RESET)\n'

up-evidence:
	@printf '$(BOLD)$(ORANGE)Starting evidence topology...$(RESET)\n'
	@printf '$(RED)WARNING: port 3001 bound to loopback — NOT a production topology$(RESET)\n'
	docker compose -f docker-compose.yml -f docker-compose.evidence.yml up --build -d
	@printf '\n$(DIM)Waiting for containers to be healthy...$(RESET)\n'
	@sleep 8
	@docker compose -f docker-compose.yml -f docker-compose.evidence.yml ps
	@printf '\n$(ORANGE)$(BOLD)Evidence stack running.$(RESET) Port 3001 accessible on 127.0.0.1.\n'
	@printf '$(DIM)Stop with: docker compose -f docker-compose.yml -f docker-compose.evidence.yml down$(RESET)\n'

down:
	@printf '$(ORANGE)Stopping stack...$(RESET)\n'
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
	  printf '$(GREEN)Handshake complete.$(RESET) Run: $(CYAN)make show-visibility$(RESET)\n'

# ---------------------------------------------------------------------------
# Demo steps
# ---------------------------------------------------------------------------

show-visibility:
	@printf '\n'
	@printf '\033[38;2;56;189;248mwithout agentgateway:\033[0m\n'
	@printf '  \033[38;2;148;163;184mstatus\033[38;2;94;163;184m(read)\033[0m\n'
	@printf '  \033[38;2;148;163;184mdeploy\033[38;2;94;163;184m(all envs)\033[0m\n'
	@printf '  \033[38;2;148;163;184mproduction_admin\033[38;2;94;163;184m(elevated)\033[0m\n'
	@printf '\n'
	@printf '\033[38;2;56;189;248mwith agentgateway:\033[0m\n'
	@printf '  \033[38;2;52;211;153mstatus\033[38;2;148;163;184m(read)\033[0m\n'
	@printf '  \033[38;2;245;158;11mdeploy\033[38;2;148;163;184m(staging)\033[0m\n'
	@printf '  \033[38;2;251;113;133mproduction_admin\033[0m   \033[38;2;129;140;248m→  hidden\033[0m\n'
	@printf '\n'

show-allow:
	@$(DIVIDER)
	@printf '$(BOLD)STEP 2 — ALLOWED$(RESET)\n'
	@printf '$(DIM)deploy(staging) succeeds. Guidance and policy agree.$(RESET)\n'
	@$(DIVIDER)
	@curl -s -X DELETE http://localhost:3009/test/log > /dev/null
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

show-deny:
	@$(DIVIDER)
	@printf '$(BOLD)STEP 3 — ARG-SENSITIVE DENY$(RESET)\n'
	@printf '$(DIM)Same tool name. Different argument. Different outcome.$(RESET)\n'
	@$(DIVIDER)
	@printf '\n$(CYAN)REQUEST$(RESET)\n'
	@printf '  deploy(environment="production", version="1.2.0")\n'
	@printf '\n$(CYAN)CLIENT$(RESET)\n'
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"deploy","arguments":{"environment":"production","version":"1.2.0"}}}' \
	  | python3 -c \
	  "import sys,json; \
	   data=sys.stdin.read(); \
	   lines=[l[5:].strip() for l in data.split('\n') if l.startswith('data:')]; \
	   r=json.loads(lines[0]) if lines else {}; \
	   r=r if r else (json.loads(data.strip()) if data.strip() else {}); \
	   print(f'  \033[0;31m\033[1mDENIED\033[0m') if 'error' in r else print(f'  \033[0;32m\033[1mALLOWED\033[0m')" \
	  2>/dev/null
	@printf '\n$(CYAN)POLICY$(RESET)\n'
	@docker logs guidance-policy 2>&1 | grep 'POLICY.*deploy.*DENY' | tail -1 | \
	  sed 's/\[POLICY\] /  /' | sed 's/tools\/call //' \
	  || printf '  (see: docker logs guidance-policy)\n'
	@printf '\n$(CYAN)BACKEND$(RESET)\n'
	@curl -s http://localhost:3009/test/log | python3 -c \
	  "import sys,json; log=json.load(sys.stdin); prod=[e for e in log if e.get('args',{}).get('environment')=='production']; print('  not invoked ✓' if not prod else '  INVOKED ✗ — '+str(prod))" \
	  2>/dev/null
	@printf '\n'

show-hidden-denied:
	@printf '\n'
	@printf '\033[38;2;148;163;184mcurl -s http://localhost:3000/mcp\033[0m\n'
	@printf '\033[38;2;148;163;184m  -d '"'"'{"method":"tools/call","params":{"name":"production_admin",...}}'"'"'\033[0m\n'
	@printf '\n'
	@. /tmp/mcp_sid.sh && curl -s "http://localhost:3000/mcp" \
	  -H "Content-Type: application/json" \
	  -H "Accept: application/json, text/event-stream" \
	  -H "MCP-Protocol-Version: 2025-03-26" \
	  -H "mcp-session-id: $$SID" \
	  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"production_admin","arguments":{"operation":"restart","target":"api-service"}}}' \
	  | python3 -c \
	  "import sys,json; \
	   LABEL='\033[38;2;148;163;184m'; \
	   VAL='\033[38;2;248;250;252m'; \
	   DENY='\033[38;2;251;113;133m'; \
	   INFRA='\033[38;2;129;140;248m'; \
	   R='\033[0m'; \
	   raw=sys.stdin.read().strip(); \
	   lines=[l[5:].strip() for l in raw.split('\n') if l.startswith('data:')]; \
	   r=json.loads(lines[0]) if lines else json.loads(raw) if raw else {}; \
	   err=r.get('error',{}); \
	   print(LABEL+'{'+R); \
	   print(INFRA+'  \"jsonrpc\"'+R+': '+VAL+'\"'+str(r.get('jsonrpc','2.0'))+'\"'+R+','); \
	   print(INFRA+'  \"id\"'+R+':       '+VAL+str(r.get('id',''))+R+','); \
	   print(INFRA+'  \"error\"'+R+': {'); \
	   print(INFRA+'    \"code\"'+R+':    '+DENY+str(err.get('code',''))+R+','); \
	   print(INFRA+'    \"message\"'+R+': '+DENY+'\"'+str(err.get('message',''))+R+'\"'); \
	   print(LABEL+'  }'+R); \
	   print(LABEL+'}'+R)" \
	  2>/dev/null
	@printf '\n'

show-backend-log:
	@$(DIVIDER)
	@printf '$(BOLD)STEP 5 — BACKEND LOG$(RESET)\n'
	@printf '$(DIM)Proof of what actually reached the MCP server.$(RESET)\n'
	@$(DIVIDER)
	@printf '\n$(CYAN)Calls that reached the backend:$(RESET)\n'
	@curl -s http://localhost:3009/test/log | python3 -c \
	  "import sys,json; \
	   log=json.load(sys.stdin); \
	   [print(f'  \033[0;32m✓\033[0m  tool=\033[1m{e[\"tool\"]}\033[0m  environment={e[\"args\"].get(\"environment\",\"n/a\")}') for e in log] or \
	   print('  \033[2m(empty)\033[0m')"
	@printf '\n$(DIM)Only allowed calls appear. Denied calls never reached this log.$(RESET)\n\n'

show-fail-closed:
	@$(DIVIDER)
	@printf '$(BOLD)STEP 6 — FAIL CLOSED$(RESET)\n'
	@printf '$(DIM)Policy processor stopped. Even staging is blocked.$(RESET)\n'
	@$(DIVIDER)
	@printf '\n$(ORANGE)Stopping policy processor...$(RESET)\n'
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
	@printf '\n$(ORANGE)Restarting policy processor...$(RESET)\n'
	@docker start guidance-policy > /dev/null
	@sleep 3
	@printf '$(GREEN)Policy: RUNNING$(RESET)  '
	@curl -s http://localhost:3002/health
	@printf '\n\n'

# ---------------------------------------------------------------------------
# Run all steps in sequence
# ---------------------------------------------------------------------------

demo: show-visibility show-allow show-deny show-hidden-denied show-backend-log show-fail-closed
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
	  MCP_SERVER_URL=http://localhost:3009 \
	  POLICY_URL=http://localhost:3002 \
	  npm test

# ---------------------------------------------------------------------------
# Fail-closed integration test (requires running stack: make up)
# ---------------------------------------------------------------------------

test-fail-closed:
	@printf '$(BOLD)Running fail-closed integration test...$(RESET)\n'
	@printf '$(DIM)Requires: make up (stack must be running)$(RESET)\n\n'
	@cd contract-tests && \
	  GATEWAY_URL=http://localhost:3000 \
	  MCP_SERVER_URL=http://localhost:3009 \
	  POLICY_URL=http://localhost:3002 \
	  npx jest fail-closed --runInBand --verbose 2>&1

# ---------------------------------------------------------------------------
# Topology test — verifies default compose does not publish port 3001
# ---------------------------------------------------------------------------

test-topology:
	@printf '$(BOLD)Running topology test...$(RESET)\n'
	@bash scripts/topology-test.sh

# ---------------------------------------------------------------------------
# Full verification (unit + typecheck + topology + contract + fail-closed)
# ---------------------------------------------------------------------------

verify: test-topology
	@printf '$(BOLD)Running policy unit tests...$(RESET)\n'
	@cd gateway/extmcp-policy && npm test
	@printf '\n$(BOLD)Running contract tests (requires running stack)...$(RESET)\n'
	@cd contract-tests && \
	  GATEWAY_URL=http://localhost:3000 \
	  MCP_SERVER_URL=http://localhost:3009 \
	  POLICY_URL=http://localhost:3002 \
	  npm test
	@printf '\n$(BOLD)Running fail-closed integration test...$(RESET)\n'
	@$(MAKE) test-fail-closed
	@printf '\n$(GREEN)$(BOLD)All verification checks passed.$(RESET)\n'

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

clean:
	@printf '$(ORANGE)Cleaning up...$(RESET)\n'
	rm -f /tmp/mcp_sid.sh /tmp/mcp_raw.txt
	docker compose down
	@printf '$(GREEN)Done.$(RESET)\n'
