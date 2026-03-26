# SQLCraft

**Master SQL — from correctness to performance.**

SQLCraft is an open-source SQL platform for sandboxed query execution, realistic datasets, execution-plan analysis, and admin-reviewed content workflows.
<p align="center">
  <img src="docs/system-architecture.png" alt="System Architecture" width="300" />
</p>

## Features

- **SQL Lab** — Browser-based SQL editor with execution plans, query history, and result comparison.
- **Isolated Sandboxes** — Each session gets a dedicated PostgreSQL container, auto-cleaned on expiry.
- **Dataset Scaling** — Same schema across 4 scales (100 → 10M+ rows) to reveal real performance differences.
- **Optimization Labs** — Side-by-side query benchmarking with index management and schema diff.

## Access Model

- **Roles** — SQLCraft uses only two system roles: **User** and **Admin**.
- **User contributions** — Content submission is a workflow available to signed-in users, not a separate RBAC role.

## Legacy Naming Note

- Some internal routes, tables, and components still use historical names such as `tracks`, `lessons`, `challenges`, and `learning_sessions`.
- Those names are implementation debt, not the canonical product framing.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS |
| Backend API | Fastify, TypeScript, Drizzle ORM |
| Worker | Node.js, BullMQ |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 |
| Storage | MinIO (S3-compatible) |
| Monorepo | pnpm workspaces + Turborepo |
| Containers | Docker + Docker Compose |

## Quick Start

### Prerequisites

- Node.js >= 20.9 (required by Next.js 16)
- pnpm >= 9 (`npm install -g pnpm@9`)
- Docker and Docker Compose

### Run locally

```bash
# Clone the repo
git clone https://github.com/thaonv7995/SQLCraft.git
cd sqlcraft

# Install dependencies and copy env
make setup

# Start everything (infra + services)
make dev
```

The app will be available at:
- **Web**: http://localhost:3000
- **API**: http://localhost:4000
- **MinIO Console**: http://localhost:9001 (user: `minioadmin`, pass: `minioadmin`)

### Useful commands

```bash
make help         # Show all available commands
make dev-infra    # Start only infrastructure (Postgres, Redis, MinIO)
make migrate      # Run database migrations
make seed         # Seed sample data
make test         # Run all tests
make lint         # Run linter
make stop         # Stop all Docker services
make clean        # Stop and remove all volumes
```

### Docker (dev images)

`docker-compose.dev.yml` builds **api**, **web**, and **worker** from `Dockerfile.dev`. Those Dockerfiles copy **`pnpm-lock.yaml`** and run **`pnpm install --frozen-lockfile`**, so the versions inside the image match the committed lockfile. After you change any `package.json` at the repo root or in a workspace, run **`pnpm install`** at the monorepo root, commit the updated **`pnpm-lock.yaml`**, then rebuild: `docker compose -f docker-compose.dev.yml build`.

To rebuild and start the full development stack in one step:

```bash
docker compose -f docker-compose.dev.yml up --build -d
```

This brings up **postgres**, **redis**, **minio**, **api**, **web**, and **worker**.

## Project Structure

```
sqlcraft/
├── apps/
│   ├── api/          # Fastify API server
│   └── web/          # Next.js 16 frontend
├── services/
│   └── worker/       # Background job worker (BullMQ)
├── packages/
│   ├── types/        # Shared TypeScript types
│   └── config/       # Shared ESLint & TS config
├── docs/             # Architecture & design docs
├── docker-compose.dev.yml
├── Makefile
└── turbo.json
```

## Documentation

The `docs/` directory contains comprehensive specifications and architecture decisions. Key entry points include:

- [Product Requirements (PRD)](./docs/PRD.md)
- [Architecture Overview](./docs/architecture.md)
- [Database Design](./docs/database-design.md)
- [API Specification](./docs/api-spec.md)
- [Contributing Guide](./CONTRIBUTING.md)
- [Environment Variables](./.env.example)

## Contributing

Contributions are welcome! Please read the [Contributing Guide](./CONTRIBUTING.md) before opening a pull request.

## License

MIT — see [LICENSE](./LICENSE) for details.
