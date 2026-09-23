#!/bin/bash
# E2E 每次调用的服务器引导（进程跨调用不存活 → 每次调用先拉起，warm .next 启动约 2s）
cd /home/z/my-project
pkill -f "next dev" 2>/dev/null
pkill -f "mock-llm.ts" 2>/dev/null
rm -f .e2e/req-log.ndjson
if ! curl -s --max-time 1 http://localhost:4100/__health > /dev/null 2>&1; then
  setsid nohup bun run .e2e/mock-llm.ts > .e2e/mock.log 2>&1 < /dev/null &
fi
setsid nohup bun run dev > dev.log 2>&1 < /dev/null &
for i in $(seq 1 60); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 2 | grep -q 200; then
    echo "server ready (attempt $i)"
    break
  fi
  sleep 1
done
curl -s --max-time 2 http://localhost:4100/__health || echo "MOCK DOWN"
