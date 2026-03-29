# Deployment Guide

This repo’s supported path is **Docker Compose production** (`docker-compose.prod.yml` + `.env.production`). See the root `README` and `install.sh` for an automated install.

## 1. Deployable units (Compose)

- **web** — Next.js (`WEB_PORT` → container `3000`)
- **api** — Fastify (`API_PORT` → `4000`)
- **worker** — BullMQ sandbox queues (`WORKER_ROLE=sandbox`): provision / reset / cleanup (**requires** Docker socket: `/var/run/docker.sock`)
- **worker-query** — BullMQ `query-execution` only (`WORKER_ROLE=query`); **no** Docker socket (separate process so long restores do not block queries)
- **postgres** — app metadata DB
- **redis** — queues
- **minio** — object storage for dataset artifacts

## 2. Server prerequisites

- **Docker Engine** with **Compose V2** (`docker compose`, not only legacy `docker-compose`).
- **`openssl`** — used by `install.sh` / `make prod-setup` for secrets.
- **Linux** recommended for **worker** (host Docker socket + sandbox containers). **worker-query** can run anywhere Redis is reachable; it does not use the Docker socket.

## 3. Environment variables (see `.env.production.example`)

Core: `STACK_NAME`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `QUEUE_PREFIX`, MinIO + `STORAGE_*`, sandbox `SANDBOX_*` / `SANDBOX_DOCKER_NETWORK`, browser URLs `PUBLIC_DOMAIN`, `NEXT_PUBLIC_*`, `ALLOWED_ORIGINS`.

Optional image overrides: `USE_PREBUILT_IMAGES`, `SQLCRAFT_GHCR_OWNER`, `SQLCRAFT_VERSION`, `API_IMAGE`, `WEB_IMAGE`, `WORKER_IMAGE`.

## 4. Install flow (`install.sh`)

1. Ensures `.env.production` (from example), secrets, ports, domain-based URLs.
2. `docker compose up` **postgres, redis, minio** (with port conflict retries).
3. Pull or build **api / web / worker** images (same image used for **worker** and **worker-query**).
4. One-off: `drizzle-kit migrate` + `db:seed` inside the **api** image (same as `make prod-build`).
5. Starts **api**, **web**, **worker**, **worker-query**.

The **api** image entrypoint also runs migrations on each container start (idempotent).

## 5. Known caveats

- **`.env` parsing in the installer** uses simple `KEY=value` splitting; avoid unquoted `=` inside values if you edit `.env.production` by hand.
- **Public HTTPS**: for non-localhost `PUBLIC_DOMAIN`, place a reverse proxy (TLS) in front of `WEB_PORT`; `STORAGE_PUBLIC_URL` / MinIO may need matching proxy rules for presigned URLs.
- **`uninstall.sh`** uses `xargs -r` (GNU); on macOS use Linux or adjust the script.

## 6. Post-deploy checks

- Open web URL, sign in with first admin from `.env.production`.
- SQL Lab: start a session, wait for sandbox **ready**, run a query.
- Worker logs: sandbox provisioning jobs complete without permanent `failed` status. Check **worker-query** if SQL runs fail while provisioning logs look fine.

---

## 7. Reverse proxy + TLS (public `PUBLIC_DOMAIN`)

Browsers should talk to **HTTPS** on **443**. The Compose stack still binds **web / api / minio** to host ports (`WEB_PORT`, `API_PORT`, `MINIO_*`); the proxy terminates TLS and forwards to **127.0.0.1** on those ports.

**Routing (same as root README):**

1. **`/`** → web (`WEB_PORT`, default `13029`).
2. **`/v1/*`** → API (`API_PORT`, default `4000`). Keep the `/v1` prefix when forwarding (the app uses `NEXT_PUBLIC_API_URL=/v1`).
3. **`/<STORAGE_BUCKET>/*`** (default bucket `sqlcraft`) → MinIO API (`MINIO_API_PORT`, default `9000`). This path must be **above** the catch-all `/` so presigned URLs from `STORAGE_PUBLIC_URL=https://your-domain` work.

**Copy-paste examples:**

- [Caddy 2](examples/caddy/Caddyfile.example) — automatic Let’s Encrypt.
- [nginx](examples/nginx/sqlcraft.conf.example) — use with certbot or your own certs.

**DNS:** Create an **A** (or **AAAA**) record for `PUBLIC_DOMAIN` pointing at the server **before** enabling HTTPS (ACME HTTP-01 needs port 80 reachable).

---

## 8. Firewall

Only expose what must be public.

**Typical public VPS (proxy on same host):**

- **22/tcp** — SSH (restrict to your IP if possible).
- **80/tcp** — HTTP (ACME challenges + redirect to HTTPS).
- **443/tcp** — HTTPS (app + API + storage paths via proxy).

**Do not** expose Postgres, Redis, or MinIO **console** to the internet unless you know why. The web app talks to the API on the **Docker network**; the browser only needs 443 (and 80 for redirects).

**ufw (Ubuntu):**

```bash
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

**Optional — direct API without path proxy (debug / mobile clients):**

```bash
sudo ufw allow 4000/tcp   # only if you intentionally expose API_PORT
```

**firewalld (RHEL/Fedora):**

```bash
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
# optional: sudo firewall-cmd --permanent --add-port=4000/tcp
sudo firewall-cmd --reload
```

Adjust ports if you changed `WEB_PORT`, `API_PORT`, or `MINIO_*` in `.env.production`.

---

## 9. Worker and Docker permissions

The **worker** (sandbox) container mounts **`/var/run/docker.sock`** so it can create/remove **sandbox engine** containers on the **same Docker host**. The **worker-query** container does **not** mount the socket; it only consumes BullMQ jobs and connects to sandbox DBs over the Docker network.

- Run Docker Engine as usual (rootful daemon is the common, supported path for this stack).
- The sandbox worker process uses the **socket**; ensure **SELinux** (if enforcing) allows the container to use the socket (many distros need the Docker CE packages’ default policies or `container_manage_cgroup` / `container_socket` rules — consult your distro if `permission denied` appears on `docker.sock`).
- **Rootless Docker** on the host is possible but **not** documented here; socket paths and permissions differ.

If provisioning fails with Docker errors in **worker** logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f worker
```

For stuck or failing **SQL Lab queries** (with sandbox already ready), tail **worker-query**:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f worker-query
```

Confirm `SANDBOX_DOCKER_NETWORK=<STACK_NAME>-prod` matches the Compose network name in `docker-compose.prod.yml`.

---

## 10. Prebuilt images (`USE_PREBUILT_IMAGES=true`) and GHCR

When `USE_PREBUILT_IMAGES=true`, `install.sh` / `make prod-build` runs `docker compose pull` for **api**, **web**, and **worker** (image reused for **worker-query**) using `API_IMAGE` / `WEB_IMAGE` / `WORKER_IMAGE` (default `ghcr.io/<owner>/sqlcraft-*`).

**Public images:** no login required; ensure outbound HTTPS to `ghcr.io` is allowed.

**Private images:** authenticate before pull:

```bash
# GitHub PAT: classic token with read:packages, or fine-grained with Packages read
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

Then re-run:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml pull api web worker
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api web worker worker-query
```

If pull fails, the installer falls back to **local build** (`docker compose build`) when possible.
