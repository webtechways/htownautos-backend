#!/bin/bash
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy --schema=libs/prisma/prisma/schema.prisma

echo "Starting services..."

# Find the actual main.js path (handles both dist structures)
API_MAIN=$(find dist -path "*/api/src/main.js" -type f | head -1)
if [ -z "$API_MAIN" ]; then
  echo "ERROR: Cannot find API main.js in dist/"
  exit 1
fi

# Start API as the main process
echo "Starting API: $API_MAIN"
node "$API_MAIN" &
API_PID=$!

# Microservices run under a restart loop. They used to be started once in the
# background: when one died nothing brought it back, and only the API takes the
# container down. data-sync died mid Copart sync on 2026-09-30, 10-01 and 10-04
# and stayed dead for hours each time — taking the Copart sync, the image cache
# crawler and the IAAI scraper with it until the next deploy.
supervise() {
  local svc="$1" main="$2" opts="$3"
  while true; do
    echo "[$svc] starting $main ${opts}"
    # `sed -u`: unbuffered, so low-volume service logs show up right away in
    # `docker logs` instead of sitting in a 4 KB block buffer.
    node $opts "$main" 2>&1 | sed -u "s/^/[$svc] /"
    local code=${PIPESTATUS[0]}
    echo "[$svc] exited with code $code at $(date -u +%FT%TZ) — restarting in 10s"
    sleep 10
  done
}

for svc in image-service ai-services data-sync; do
  SVC_MAIN=$(find dist -path "*/$svc/src/main.js" -type f 2>/dev/null | head -1)
  if [ -n "$SVC_MAIN" ]; then
    OPTS=""
    # The Copart CSV parse is data-sync's peak (~140k rows); the default heap
    # limit on this host is ~4 GB. The host has 22 GB.
    if [ "$svc" = "data-sync" ]; then OPTS="--max-old-space-size=6144"; fi
    supervise "$svc" "$SVC_MAIN" "$OPTS" &
  fi
done

# Only wait on the API process — if it dies, container restarts
wait $API_PID
exit $?
