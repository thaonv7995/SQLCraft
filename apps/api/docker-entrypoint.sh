#!/bin/sh
set -e

wait_for_database() {
  if [ -z "$DATABASE_URL" ]; then
    echo "DATABASE_URL is not set; skipping database readiness check"
    return 0
  fi

  echo "Waiting for database to become reachable..."
  node <<'NODE'
const net = require('node:net');

const timeoutMs = Number(process.env.DB_WAIT_TIMEOUT_MS || 120000);
const intervalMs = Number(process.env.DB_WAIT_INTERVAL_MS || 2000);
const deadline = Date.now() + timeoutMs;
const databaseUrl = new URL(process.env.DATABASE_URL);
const host = databaseUrl.hostname;
const port = Number(databaseUrl.port || 5432);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(5000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

(async () => {
  while (Date.now() < deadline) {
    if (await canConnect()) {
      console.log(`Database is reachable at ${host}:${port}`);
      return;
    }
    console.log(`Database not ready at ${host}:${port}; retrying...`);
    await sleep(intervalMs);
  }

  console.error(`Timed out waiting for database at ${host}:${port}`);
  process.exit(1);
})();
NODE
}

cd /app
wait_for_database
pnpm --filter @sqlcraft/api exec drizzle-kit migrate
exec pnpm --filter @sqlcraft/api start
