SQL platform for **sandboxed query execution**, **realistic datasets**, **execution-plan analysis**, and **admin-reviewed** lessons, challenges, and catalog content.

<p align="center">
  <img src="docs/system-architecture.png" alt="System architecture" width="300" />
</p>

## Features

- **SQL Lab** — Browser SQL editor, execution plans, history, result comparison.
- **Isolated sandboxes** — Per-session database containers (engine from the schema template), auto-expiry.
- **AI Assistant** — AI-powered SQL query generation, optimization, and explanation.
- **Dataset scaling** — Same schema from tiny to large row counts for real performance tradeoffs.
- **Optimization labs** — Side-by-side runs, index tooling, schema diff.

## Tech stack

| Layer | Technology |
|------|------------|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS |
| API | Fastify, TypeScript, Drizzle ORM |
| Worker | Node.js, BullMQ |
| App DB | PostgreSQL 16 |
| Queue / cache | Redis 7 |
| Object storage | MinIO (S3-compatible) |
| Repo | pnpm workspaces, Turborepo |
| Runtime | Docker, Docker Compose |

## Requirements

**Production (`install.sh` or `make prod-build`):**

- **Docker Engine** with **Compose V2** (`docker compose` — not only legacy `docker-compose`)
- **`openssl`** (secrets generation)
- **Linux** recommended for the **worker** (Docker socket + sandbox containers)

**Development** (optional): Node **≥ 20.9**, **pnpm ≥ 9** — see [Development](#development).

## Production install

### One-liner (downloads installer from `main`)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/thaonv7995/SQLCraft/main/install.sh)
```

### From a clone

```bash
git clone https://github.com/thaonv7995/SQLCraft.git
cd SQLCraft
./install.sh
```

The installer will:

1. Bootstrap a copy under `SQLCRAFT_INSTALL_DIR` (default `~/.sqlcraft`) **only if** compose/env templates are missing from the current directory.
2. Create or preserve **`.env.production`** from **`.env.production.example`**.
3. Generate secrets (`JWT_SECRET`, DB, MinIO, sandbox passwords) where needed.
4. Prompt for **first admin** and **`PUBLIC_DOMAIN`** (sets browser/API/storage URLs).
5. Start **postgres**, **redis**, **minio**; **pull** GHCR images or **build** locally if pull fails.
6. Run **migrations** + **seed** inside the API image.
7. Start **api**, **web**, **worker**.

Default host ports: web **13029**, API **4000**, MinIO API **9000**, console **9001**. If any port is already in use the installer **automatically picks the next free port** — check actual values before configuring a reverse proxy:

```bash
grep -E 'WEB_PORT|API_PORT|MINIO_API_PORT|MINIO_CONSOLE_PORT' .env.production
# or live container bindings:
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

## After install

| Service | URL (defaults) |
|--------|----------------|
| Web | http://localhost:13029 |
| API (direct) | http://localhost:4000 |
| MinIO console | http://localhost:9001 |

Credentials for the **first admin** are printed at the end of the run (also in `.env.production`).

The API container **runs migrations on each start** (`apps/api/docker-entrypoint.sh`) — safe to restart.

## Public internet (HTTPS)

For a **real domain**, `install.sh` alone does **not** configure TLS or firewall. After install:

1. Point **DNS** at the server.
2. Add a **reverse proxy** (TLS) with these routes (use ports from `.env.production`, not the defaults, if they were auto-adjusted):
   - **`/<STORAGE_BUCKET>/*`** → MinIO API (`MINIO_API_PORT`) — **must be above the catch-all** so presigned avatar/upload URLs work. Add the following to your nginx config:
     ```nginx
     location /sqlcraft/ {
         proxy_pass http://127.0.0.1:9000;  # use MINIO_API_PORT
         proxy_http_version 1.1;
         proxy_set_header Host $host;
         proxy_set_header X-Real-IP $remote_addr;
         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
         proxy_set_header X-Forwarded-Proto $scheme;
         client_max_body_size 0;
         proxy_request_buffering off;
     }
     ```
   - **`/v1/*`** → API (`API_PORT`)
   - **`/`** → web (`WEB_PORT`)

   Ready-to-use examples: **[docs/examples/](docs/examples/)** (Caddy / nginx). Full details: **[docs/deployment-guide.md](docs/deployment-guide.md)** §7–10.
3. Open firewall **80/443** (and SSH); avoid exposing Postgres, Redis, or MinIO console publicly unless required.
4. **Private GHCR images:** `docker login ghcr.io` before pull (see deployment guide §10).

## Commands

```bash
make prod            # Start stack (no image rebuild)
make prod-stop       # Stop stack
make prod-logs       # Tail logs
make prod-clean      # Stop and remove volumes (uses .env.production when present)
make prod-build      # Interactive .env + full bootstrap (from repo clone)
make release-docker  # Build production images only
./uninstall.sh       # Tear down stack (see script for --purge-env / --remove-source)
```

Compose always uses **`docker-compose.prod.yml`** and **`.env.production`** for production.

## Development

```bash
make setup    # One-time dev dependencies
make dev      # Hot-reload API + web (+ local infra per Makefile)
```

Typical dev URLs match production defaults on localhost.

**Full dev stack in Docker:**

```bash
docker compose -f docker-compose.dev.yml up --build -d
```

This starts **`worker`** (`WORKER_ROLE=sandbox`, Docker + provision/cleanup) and **`worker-query`** (`WORKER_ROLE=query`, BullMQ queries only) as separate containers so heavy dataset restores do not share the same Node process with interactive queries.

After changing workspace `package.json` files, run **`pnpm install`** at the repo root, commit **`pnpm-lock.yaml`**, then rebuild dev images.

## Docker images & releases

- **Production compose:** [`docker-compose.prod.yml`](docker-compose.prod.yml) — `apps/api/Dockerfile`, `apps/web/Dockerfile`, `services/worker/Dockerfile`.
- **CI build:** [`.github/workflows/docker.yml`](.github/workflows/docker.yml).
- **Publish to GHCR:** push a tag **`v*`** (e.g. `v0.1.0`) — [`.github/workflows/release.yml`](.github/workflows/release.yml) pushes `sqlcraft-api`, `sqlcraft-web`, `sqlcraft-worker`. Use lowercase owner in image URLs. Set package visibility to **public** on GitHub if you want unauthenticated `docker pull`.

Installer env knobs: `USE_PREBUILT_IMAGES`, `SQLCRAFT_GHCR_OWNER`, `SQLCRAFT_VERSION`, `API_IMAGE`, `WEB_IMAGE`, `WORKER_IMAGE` (see `.env.production.example`).

## Troubleshooting

**“Sandbox could not start” (Linux)**

- Restart workers:  
  `docker compose --env-file .env.production -f docker-compose.prod.yml up -d worker worker-query`
- Ensure `SANDBOX_DOCKER_NETWORK=<STACK_NAME>-prod` in `.env.production`.
- Logs:  
  `docker compose --env-file .env.production -f docker-compose.prod.yml logs -f worker worker-query`

**Avatar or SQL dump upload fails (404 / 413 via reverse proxy)**

- **404 "Resource not found"** — the `/sqlcraft/` location block is missing from nginx/Caddy. Presigned MinIO URLs use this path; add a proxy rule for `/<STORAGE_BUCKET>/` → `MINIO_API_PORT`.
- **413 Content Too Large** — nginx is rejecting the upload body. Add to the `/sqlcraft/` location: `client_max_body_size 0; proxy_request_buffering off;`
- Both fixes are included in [docs/examples/nginx/sqlcraft.conf.example](docs/examples/nginx/sqlcraft.conf.example).

**Compose / pull**

- Requires **`docker compose`** (v2 plugin).  
- If GHCR pull fails, the installer falls back to **local build** when possible.

## Repository layout

```
├── apps/
│   ├── api/                 # Fastify API
│   └── web/                 # Next.js frontend
├── services/
│   └── worker/              # BullMQ worker + sandbox provisioning
├── packages/
│   ├── types/               # Shared TypeScript types
│   └── config/              # Shared ESLint / TS config
├── docs/                    # PRD, architecture, deployment, examples
├── docker-compose.dev.yml
├── docker-compose.prod.yml
├── install.sh
├── uninstall.sh
├── Makefile
└── turbo.json
```

## Author & support

**Thao Nguyen** — [LinkedIn](https://www.linkedin.com/in/thaonv795/) · [Buy Me a Coffee](https://buymeacoffee.com/thaonv795)

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/authors.md](docs/authors.md) | Maintainer, social links, ways to support the project |
| [docs/deployment-guide.md](docs/deployment-guide.md) | Production deploy, TLS, firewall, worker, GHCR |
| [docs/examples/](docs/examples/) | Caddy / nginx samples |
| [docs/PRD.md](docs/PRD.md) | Product requirements |
| [docs/architecture.md](docs/architecture.md) | System architecture |
| [docs/database-design.md](docs/database-design.md) | Data model |
| [docs/api-spec.md](docs/api-spec.md) | API specification |
| [docs/sqlite-dump-from-db.md](docs/sqlite-dump-from-db.md) | Export SQLite `.db` to `.sql` before catalog / admin import |
| [.env.production.example](.env.production.example) | Production environment template |
| [.env.example](.env.example) | Development env reference |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests welcome.

## License

[MIT](LICENSE)
