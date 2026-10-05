#!/usr/bin/env python3
"""Parse SSE tools/list response and print tool names with color."""
import sys
import json

GREEN = '\033[0;32m'
RESET = '\033[0m'

for line in sys.stdin:
    if line.startswith('data:'):
        try:
            r = json.loads(line[5:].strip())
            tools = r.get('result', {}).get('tools', [])
            for t in tools:
                print(f'  {GREEN}{t["name"]}{RESET}')
        except json.JSONDecodeError:
            pass
