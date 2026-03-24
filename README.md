# SQLCraft

**Master SQL — from correctness to performance.**

SQLCraft is an open-source, interactive SQL learning platform that takes you beyond writing queries that merely return the right answer. Learn to write SQL that is correct, efficient, and production-ready — through hands-on labs, real execution plans, and progressive dataset scaling.

## Features

- **Interactive SQL Lab** — Write and run SQL directly in the browser. View tabular results, query duration, scanned rows, and visual `EXPLAIN ANALYZE` execution plans to spot bottlenecks.
- **Progressive Dataset Scaling** — Practice with the same schema across multiple data scales (Tiny: 100 rows ➔ Small: 100K ➔ Medium: 5M ➔ Large: 10M-100M+ rows) to see real performance implications.
- **Session Query History** — Every execution is stored within the active learning session so learners can reopen prior SQL, compare before/after runs, and reuse the strongest execution for challenge submission.
- **Query Optimization Labs** — Run side-by-side query comparisons, create and drop indexes safely, inspect schema drift against the published base schema, and reset the sandbox back to base after experiments.
- **User Sandbox Isolation** — Every learning session provisions a dedicated, ephemeral PostgreSQL container attached to the internal Docker network. Cleanup is automatic on session end and TTL expiry.
- **Structured Lesson & Challenge Engine** — Curated tracks and versioned content. Challenges are evaluated automatically with weighted **correctness**, **performance**, and **index optimization** scoring where configured, using full result-set comparison plus EXPLAIN-backed index checks.
- **Admin & Contributor Tools** — Built-in tools for async dataset generation and a contributor workflow that captures reference solutions, expected columns, and optimization baselines for community-created challenges.

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
git clone https://github.com/sqlcraft/sqlcraft.git
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

## Screenshots

> Coming soon — the lab is still being built.

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
