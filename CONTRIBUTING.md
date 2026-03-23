# Contributing to SQLCraft

Thank you for your interest in contributing to SQLCraft! This guide will help you get started.

## Prerequisites

Before you begin, make sure you have the following installed:

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0 (`npm install -g pnpm@9`)
- **Docker** and **Docker Compose** (for running infrastructure services)
- **Git**

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/sqlcraft/sqlcraft.git
   cd sqlcraft
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in any values you need to change for your local setup. The defaults work for the Docker Compose dev environment.

4. **Start the development environment**

   ```bash
   make dev
   ```

   This will:
   - Start PostgreSQL, Redis, MinIO, and the sandbox database via Docker Compose
   - Run database migrations
   - Seed the database with sample data
   - Start the API, web, and worker services with hot-reloading

5. **Open the app**

   - Web: http://localhost:3000
   - API: http://localhost:4000
   - MinIO Console: http://localhost:9001

## Project Structure

```
sqlcraft/
├── apps/
│   ├── api/          # Fastify API server (TypeScript)
│   └── web/          # Next.js 14 frontend (App Router)
├── services/
│   └── worker/       # BullMQ background worker
├── packages/
│   ├── types/        # Shared TypeScript types
│   └── config/       # Shared ESLint/TS config
├── docs/             # Project documentation
├── docker-compose.dev.yml
├── Makefile
└── turbo.json
```

## Code Style

We use **Prettier** for formatting and **ESLint** for linting.

- **Format code**: `make format` or `pnpm exec prettier --write .`
- **Lint code**: `make lint` or `pnpm run lint`
- **Type check**: `make typecheck` or `pnpm run typecheck`

Configuration files:
- `.prettierrc` — Prettier config (single quotes, 2 spaces, 100 char width)
- `packages/config/eslint-base.js` — Shared ESLint base config

Please ensure your code passes lint and typecheck before submitting a PR.

## Branch Naming

Use the following prefixes for branch names:

| Prefix    | Use case                                 |
|-----------|------------------------------------------|
| `feat/`   | New features (e.g., `feat/sql-editor`)   |
| `fix/`    | Bug fixes (e.g., `fix/session-timeout`)  |
| `docs/`   | Documentation changes                    |
| `chore/`  | Maintenance tasks, dependency updates    |
| `refactor/` | Code refactoring without behavior change |
| `test/`   | Adding or improving tests                |

## Pull Request Process

1. **Fork** the repository and create your branch from `develop`.
2. **Make your changes** with clear, focused commits.
3. **Write tests** for new functionality where applicable.
4. **Ensure CI passes**: lint, typecheck, and tests must all pass.
5. **Fill out the PR template** when opening your pull request.
6. **Request a review** from a maintainer.
7. PRs are merged into `develop` first, then `main` on release.

### Commit Message Style

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(api): add sandbox provisioning endpoint
fix(web): resolve editor theme flicker on dark mode
docs: update contributing guide
chore(deps): upgrade drizzle-orm to 0.31
```

## Running Tests

```bash
# Run all tests
make test

# Run API tests only
make test-api

# Run frontend tests only
make test-web
```

Tests use **Vitest**. Test files live alongside source files with `.test.ts` or `.spec.ts` extensions.

## Database Changes

If your change requires a schema migration:

1. Edit the schema in `apps/api/src/db/schema/`
2. Generate a migration: `pnpm --filter @sqlcraft/api db:generate`
3. Review the generated migration in `apps/api/src/db/migrations/`
4. Apply it: `make migrate`

Never edit existing migration files — always generate new ones.

## Need Help?

- Check the `docs/` folder for architecture and design documentation.
- Open a [GitHub Discussion](https://github.com/sqlcraft/sqlcraft/discussions) for questions.
- Open an [Issue](https://github.com/sqlcraft/sqlcraft/issues) for bugs.
