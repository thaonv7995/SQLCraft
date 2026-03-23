# SQLCraft

**Master SQL — from correctness to performance.**

SQLCraft is an open-source, interactive SQL learning platform that takes you beyond writing queries that merely return the right answer. Learn to write SQL that is correct, efficient, and production-ready — through hands-on labs, real execution plans, and progressive dataset scaling.

## Features

- **Interactive SQL Lab** — Write and run SQL directly in the browser against a real PostgreSQL sandbox. Instant feedback, no setup required.
- **Progressive Dataset Scaling** — Start with tiny datasets to understand query logic, then scale to millions of rows to see performance implications firsthand.
- **Query Optimization Labs** — Structured challenges that teach you to improve slow queries using indexes, rewrites, and query planning techniques.
- **Execution Plan Viewer** — Visual, annotated `EXPLAIN ANALYZE` output that demystifies query plans and helps you spot bottlenecks at a glance.
- **Structured Learning Tracks** — Curated tracks from SQL fundamentals through advanced window functions, CTEs, and performance tuning.
- **Challenge System** — Solve problems with automated evaluation — correctness is checked, and performance is scored.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Backend API | Fastify, TypeScript, Drizzle ORM |
| Worker | Node.js, BullMQ |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 |
| Storage | MinIO (S3-compatible) |
| Monorepo | pnpm workspaces + Turborepo |
| Containers | Docker + Docker Compose |

## Quick Start

### Prerequisites

- Node.js >= 20
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

## Project Structure

```
sqlcraft/
├── apps/
│   ├── api/          # Fastify API server
│   └── web/          # Next.js 14 frontend
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

- [Architecture Overview](./docs/)
- [Contributing Guide](./CONTRIBUTING.md)
- [Environment Variables](./.env.example)

## Contributing

Contributions are welcome! Please read the [Contributing Guide](./CONTRIBUTING.md) before opening a pull request.

## License

MIT — see [LICENSE](./LICENSE) for details.
