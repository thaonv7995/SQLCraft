#!/bin/sh
set -e
cd /app
pnpm --filter @sqlcraft/api exec drizzle-kit migrate
exec pnpm --filter @sqlcraft/api start
