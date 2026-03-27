#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE=""
ENV_EXAMPLE_FILE=""
COMPOSE_FILE=""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log() {
  printf "${GREEN}%s${RESET}\n" "$1"
}

warn() {
  printf "${YELLOW}%s${RESET}\n" "$1"
}

error() {
  printf "${RED}%s${RESET}\n" "$1"
}

headline() {
  printf "\n${BOLD}${CYAN}%s${RESET}\n" "$1"
}

update_paths() {
  ENV_FILE="${ROOT_DIR}/.env.production"
  ENV_EXAMPLE_FILE="${ROOT_DIR}/.env.production.example"
  COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
}

print_logo() {
  printf "\n${BOLD}${GREEN}"
  cat <<'EOF'
   ____   ___  _      ____ ____      _    _____ _____
  / ___| / _ \| |    / ___|  _ \    / \  |  ___|_   _|
  \___ \| | | | |   | |   | |_) |  / _ \ | |_    | |
   ___) | |_| | |___| |___|  _ <  / ___ \|  _|   | |
  |____/ \__\_\_____|\____|_| \_\/_/   \_\_|     |_|
EOF
  printf "${RESET}"
  printf "${CYAN}  Master SQL — from correctness to performance.${RESET}\n\n"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "Missing required command: $1"
    exit 1
  fi
}

bootstrap_project_if_needed() {
  update_paths
  if [[ -f "$COMPOSE_FILE" && -f "$ENV_EXAMPLE_FILE" ]]; then
    return
  fi

  headline "Project files not found. Bootstrapping SQLCraft source"
  require_cmd curl
  require_cmd tar
  require_cmd mktemp

  local repo ref target_dir tmp_dir archive_path src_dir
  repo="${SQLCRAFT_GITHUB_REPO:-thaonv7995/SQLCraft}"
  ref="${SQLCRAFT_GITHUB_REF:-main}"
  target_dir="${SQLCRAFT_INSTALL_DIR:-$HOME/.sqlcraft}"

  tmp_dir="$(mktemp -d)"
  archive_path="${tmp_dir}/sqlcraft.tar.gz"

  log "Downloading ${repo}@${ref} ..."
  curl -fsSL "https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}" -o "$archive_path"

  mkdir -p "${tmp_dir}/src"
  tar -xzf "$archive_path" -C "${tmp_dir}/src"
  src_dir="$(find "${tmp_dir}/src" -mindepth 1 -maxdepth 1 -type d | head -n 1)"

  if [[ -z "$src_dir" ]]; then
    error "Failed to extract SQLCraft source."
    rm -rf "$tmp_dir"
    exit 1
  fi

  mkdir -p "$target_dir"
  rm -rf "${target_dir:?}/"*
  cp -R "${src_dir}/." "$target_dir/"
  rm -rf "$tmp_dir"

  ROOT_DIR="$target_dir"
  update_paths
  log "Project files installed at: $ROOT_DIR"
}

get_env_value() {
  local key="$1"
  local file="$2"
  awk -F= -v k="$key" '$1==k {print $2; exit}' "$file"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local file="$3"
  awk -v k="$key" -v v="$value" '
    BEGIN { done=0 }
    $0 ~ ("^"k"=") { print k"="v; done=1; next }
    { print }
    END { if (!done) print k"="v }
  ' "$file" > "${file}.tmp"
  mv "${file}.tmp" "$file"
}

ensure_env_file() {
  if [[ ! -f "$ENV_EXAMPLE_FILE" ]]; then
    error "Missing ${ENV_EXAMPLE_FILE}"
    exit 1
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
    log "Created .env.production from template."
  else
    warn ".env.production already exists, keeping your current values."
  fi
}

ensure_or_generate_secret() {
  local key="$1"
  local bytes="$2"
  local current
  current="$(get_env_value "$key" "$ENV_FILE")"

  if [[ -z "${current}" || "${current}" == "change-me" ]]; then
    local generated
    generated="$(openssl rand -hex "$bytes")"
    set_env_value "$key" "$generated" "$ENV_FILE"
  fi
}

configure_admin() {
  headline "First admin setup"
  local current_email current_username current_password
  current_email="$(get_env_value "FIRST_ADMIN_EMAIL" "$ENV_FILE")"
  current_username="$(get_env_value "FIRST_ADMIN_USERNAME" "$ENV_FILE")"
  current_password="$(get_env_value "FIRST_ADMIN_PASSWORD" "$ENV_FILE")"

  local default_email="admin@sqlcraft.local"
  local default_username="admin"
  local default_password
  default_password="$(openssl rand -hex 12)"

  if [[ -z "$current_email" || "$current_email" == "$default_email" ]]; then
    printf "FIRST_ADMIN_EMAIL [%s]: " "$default_email"
    read -r input_email
    set_env_value "FIRST_ADMIN_EMAIL" "${input_email:-$default_email}" "$ENV_FILE"
  fi

  if [[ -z "$current_username" || "$current_username" == "$default_username" ]]; then
    printf "FIRST_ADMIN_USERNAME [%s]: " "$default_username"
    read -r input_username
    set_env_value "FIRST_ADMIN_USERNAME" "${input_username:-$default_username}" "$ENV_FILE"
  fi

  if [[ -z "$current_password" || "$current_password" == "change-me" ]]; then
    printf "FIRST_ADMIN_PASSWORD [auto-generated]: "
    read -r input_password
    set_env_value "FIRST_ADMIN_PASSWORD" "${input_password:-$default_password}" "$ENV_FILE"
  fi
}

configure_domain() {
  headline "Domain setup"
  local current_domain input_domain
  current_domain="$(get_env_value "PUBLIC_DOMAIN" "$ENV_FILE")"
  if [[ -z "$current_domain" ]]; then
    current_domain="localhost"
  fi
  printf "PUBLIC_DOMAIN [%s]: " "$current_domain"
  read -r input_domain
  set_env_value "PUBLIC_DOMAIN" "${input_domain:-$current_domain}" "$ENV_FILE"
}

ensure_core_env() {
  local current_stack desired_stack
  current_stack="$(normalize_stack_name "$(get_env_value "STACK_NAME" "$ENV_FILE")")"
  if [[ -n "$current_stack" ]]; then
    desired_stack="$current_stack"
  else
    desired_stack="$(pick_stack_name "sqlcraft")"
  fi
  if [[ "$desired_stack" != "${current_stack:-}" ]]; then
    warn "Using stack name: ${desired_stack}"
  fi
  set_env_value "STACK_NAME" "$desired_stack" "$ENV_FILE"
  set_env_value "SANDBOX_DOCKER_NETWORK" "${desired_stack}-prod" "$ENV_FILE"

  ensure_port "WEB_PORT" 13029
  ensure_port "API_PORT" 4000
  ensure_port "POSTGRES_PORT" 5432
  ensure_port "REDIS_PORT" 6379
  ensure_port "MINIO_API_PORT" 9000
  ensure_port "MINIO_CONSOLE_PORT" 9001

  ensure_or_generate_secret "JWT_SECRET" 32
  ensure_or_generate_secret "POSTGRES_PASSWORD" 16
  ensure_or_generate_secret "MINIO_ROOT_PASSWORD" 16
  ensure_or_generate_secret "STORAGE_SECRET_KEY" 16
  ensure_or_generate_secret "SANDBOX_DB_PASSWORD" 16

  local postgres_password web_port api_port minio_api_port public_domain
  postgres_password="$(get_env_value "POSTGRES_PASSWORD" "$ENV_FILE")"
  web_port="$(get_env_value "WEB_PORT" "$ENV_FILE")"
  api_port="$(get_env_value "API_PORT" "$ENV_FILE")"
  minio_api_port="$(get_env_value "MINIO_API_PORT" "$ENV_FILE")"
  public_domain="$(get_env_value "PUBLIC_DOMAIN" "$ENV_FILE")"
  if [[ -z "$public_domain" ]]; then
    public_domain="localhost"
  fi

  set_env_value "DATABASE_URL" "postgresql://sqlcraft:${postgres_password}@postgres:5432/sqlcraft" "$ENV_FILE"
  if [[ "$public_domain" == "localhost" || "$public_domain" == "127.0.0.1" ]]; then
    set_env_value "NEXT_PUBLIC_APP_URL" "http://localhost:${web_port}" "$ENV_FILE"
    set_env_value "ALLOWED_ORIGINS" "http://localhost:${web_port}" "$ENV_FILE"
    set_env_value "NEXT_PUBLIC_API_URL" "/v1" "$ENV_FILE"
    set_env_value "NEXT_INTERNAL_API_ORIGIN" "http://api:4000" "$ENV_FILE"
    set_env_value "API_DOMAIN" "localhost" "$ENV_FILE"
    set_env_value "STORAGE_PUBLIC_URL" "http://localhost:${minio_api_port}" "$ENV_FILE"
  else
    set_env_value "NEXT_PUBLIC_APP_URL" "https://${public_domain}" "$ENV_FILE"
    set_env_value "ALLOWED_ORIGINS" "https://${public_domain},http://localhost:${web_port}" "$ENV_FILE"
    set_env_value "NEXT_PUBLIC_API_URL" "/v1" "$ENV_FILE"
    set_env_value "NEXT_INTERNAL_API_ORIGIN" "http://api:4000" "$ENV_FILE"
    set_env_value "API_DOMAIN" "${public_domain}" "$ENV_FILE"
    set_env_value "STORAGE_PUBLIC_URL" "https://${public_domain}" "$ENV_FILE"
  fi
}

wait_for_docker() {
  if ! docker info >/dev/null 2>&1; then
    error "Docker daemon is not running. Please start Docker Desktop / dockerd."
    exit 1
  fi
}

is_port_in_use() {
  local port="$1"

  # Most reliable check when python3 exists: try binding host port directly.
  if command -v python3 >/dev/null 2>&1; then
    if ! python3 - "$port" <<'PY' >/dev/null 2>&1
import socket, sys
port = int(sys.argv[1])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    s.bind(("0.0.0.0", port))
    s.close()
    sys.exit(0)  # bind success => free
except OSError:
    sys.exit(1)  # bind failed => in use
PY
    then
      return 0
    fi
  fi

  # Docker-published ports (works even when host tools miss docker-proxy/rootless binds)
  if docker ps --format '{{.Ports}}' | grep -Eq "(0\\.0\\.0\\.0:${port}->|\\[::\\]:${port}->|:::${port}->)"; then
    return 0
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH | awk '{print $4}' | grep -Eq "(^|[:.])${port}$"
    return $?
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|[:.])${port}$"
    return $?
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return $?
  fi
  (echo >"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1
}

find_free_port() {
  local candidate="$1"
  while is_port_in_use "$candidate"; do
    candidate=$((candidate + 1))
  done
  echo "$candidate"
}

is_port_reserved_by_env() {
  local port="$1"
  local current_key="$2"
  local key value
  for key in WEB_PORT API_PORT POSTGRES_PORT REDIS_PORT MINIO_API_PORT MINIO_CONSOLE_PORT; do
    if [[ "$key" == "$current_key" ]]; then
      continue
    fi
    value="$(get_env_value "$key" "$ENV_FILE")"
    if [[ -n "$value" && "$value" == "$port" ]]; then
      return 0
    fi
  done
  return 1
}

ensure_port() {
  local key="$1"
  local default_port="$2"
  local value selected
  value="$(get_env_value "$key" "$ENV_FILE")"
  if [[ -z "$value" ]]; then
    value="$default_port"
  fi
  selected="$value"
  while true; do
    selected="$(find_free_port "$selected")"
    if ! is_port_reserved_by_env "$selected" "$key"; then
      break
    fi
    selected=$((selected + 1))
  done
  if [[ "$selected" != "$value" ]]; then
    warn "Port ${value} is busy; using ${selected} for ${key}."
  fi
  set_env_value "$key" "$selected" "$ENV_FILE"
}

pick_stack_name() {
  local base desired candidate suffix
  base="${1:-sqlcraft}"
  desired="$base"
  local names
  names="$(docker ps -a --format '{{.Names}}')"
  if ! grep -Eq "^${desired}-(postgres|redis|minio|api|web|worker)$" <<<"$names"; then
    echo "$desired"
    return
  fi
  suffix="${USER:-dev}"
  candidate="${base}-${suffix}"
  if ! grep -Eq "^${candidate}-(postgres|redis|minio|api|web|worker)$" <<<"$names"; then
    echo "$candidate"
    return
  fi
  echo "${base}-$(date +%s)"
}

normalize_stack_name() {
  local name="$1"
  local suffix="${USER:-dev}"
  if [[ -z "$name" ]]; then
    echo ""
    return
  fi
  while [[ "$name" == *"-${suffix}-${suffix}" ]]; do
    name="${name/%-${suffix}/}"
  done
  echo "$name"
}

run_compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

port_key_by_number() {
  local port="$1"
  local web_port api_port pg_port redis_port minio_api_port minio_console_port
  web_port="$(get_env_value "WEB_PORT" "$ENV_FILE")"
  api_port="$(get_env_value "API_PORT" "$ENV_FILE")"
  pg_port="$(get_env_value "POSTGRES_PORT" "$ENV_FILE")"
  redis_port="$(get_env_value "REDIS_PORT" "$ENV_FILE")"
  minio_api_port="$(get_env_value "MINIO_API_PORT" "$ENV_FILE")"
  minio_console_port="$(get_env_value "MINIO_CONSOLE_PORT" "$ENV_FILE")"

  if [[ "$port" == "$web_port" ]]; then echo "WEB_PORT"; return; fi
  if [[ "$port" == "$api_port" ]]; then echo "API_PORT"; return; fi
  if [[ "$port" == "$pg_port" ]]; then echo "POSTGRES_PORT"; return; fi
  if [[ "$port" == "$redis_port" ]]; then echo "REDIS_PORT"; return; fi
  if [[ "$port" == "$minio_api_port" ]]; then echo "MINIO_API_PORT"; return; fi
  if [[ "$port" == "$minio_console_port" ]]; then echo "MINIO_CONSOLE_PORT"; return; fi
  echo ""
}

infra_up_with_retry() {
  local attempt output port key next_port
  for attempt in 1 2 3; do
    if output="$(run_compose up -d --build postgres redis minio 2>&1)"; then
      return 0
    fi

    if grep -q "port is already allocated" <<<"$output"; then
      port="$(grep -Eo ':[0-9]+ failed: port is already allocated' <<<"$output" | head -n1 | grep -Eo '[0-9]+' || true)"
      if [[ -n "$port" ]]; then
        key="$(port_key_by_number "$port")"
        if [[ -n "$key" ]]; then
          next_port="$(find_free_port "$((port + 1))")"
          warn "Docker reports port ${port} conflict. Retrying with ${key}=${next_port}."
          set_env_value "$key" "$next_port" "$ENV_FILE"
          continue
        fi
      fi
    fi

    err "$output"
    return 1
  done

  err "Failed to start infrastructure after retries."
  return 1
}

bootstrap_stack() {
  headline "Bootstrapping infrastructure"
  # Re-check critical published ports right before compose up
  ensure_port "WEB_PORT" 13029
  ensure_port "API_PORT" 4000
  ensure_port "POSTGRES_PORT" 5432
  ensure_port "REDIS_PORT" 6379
  ensure_port "MINIO_API_PORT" 9000
  ensure_port "MINIO_CONSOLE_PORT" 9001

  local web_port api_port pg_port redis_port minio_api_port minio_console_port
  web_port="$(get_env_value "WEB_PORT" "$ENV_FILE")"
  api_port="$(get_env_value "API_PORT" "$ENV_FILE")"
  pg_port="$(get_env_value "POSTGRES_PORT" "$ENV_FILE")"
  redis_port="$(get_env_value "REDIS_PORT" "$ENV_FILE")"
  minio_api_port="$(get_env_value "MINIO_API_PORT" "$ENV_FILE")"
  minio_console_port="$(get_env_value "MINIO_CONSOLE_PORT" "$ENV_FILE")"
  log "Using ports -> web:${web_port}, api:${api_port}, postgres:${pg_port}, redis:${redis_port}, minio:${minio_api_port}/${minio_console_port}"

  infra_up_with_retry

  headline "Running migrations + seed"
  run_compose run --rm --entrypoint sh api -lc \
    "pnpm --filter @sqlcraft/api exec drizzle-kit migrate && pnpm --filter @sqlcraft/api db:seed"

  headline "Starting API + Web + Worker"
  run_compose up -d --build api web worker
}

print_summary() {
  local admin_email admin_username admin_password web_port api_port minio_console_port stack_name
  admin_email="$(get_env_value "FIRST_ADMIN_EMAIL" "$ENV_FILE")"
  admin_username="$(get_env_value "FIRST_ADMIN_USERNAME" "$ENV_FILE")"
  admin_password="$(get_env_value "FIRST_ADMIN_PASSWORD" "$ENV_FILE")"
  web_port="$(get_env_value "WEB_PORT" "$ENV_FILE")"
  api_port="$(get_env_value "API_PORT" "$ENV_FILE")"
  minio_console_port="$(get_env_value "MINIO_CONSOLE_PORT" "$ENV_FILE")"
  stack_name="$(get_env_value "STACK_NAME" "$ENV_FILE")"
  local access_url api_url minio_url
  access_url="http://localhost:${web_port}"
  api_url="http://localhost:${api_port}"
  minio_url="http://localhost:${minio_console_port}"

  print_logo

  printf "${GREEN}+------------------------------------------------------------------+${RESET}\n"
  printf "${GREEN}|${RESET} ${BOLD}Installation complete!${RESET}                                           ${GREEN}|${RESET}\n"
  printf "${GREEN}+------------------------------------------------------------------+${RESET}\n"
  printf "${GREEN}|${RESET} Access URL      ${CYAN}%-49s${RESET}${GREEN}|${RESET}\n" "$access_url"
  printf "${GREEN}|${RESET} API URL         ${CYAN}%-49s${RESET}${GREEN}|${RESET}\n" "$api_url"
  printf "${GREEN}|${RESET} MinIO Console   ${CYAN}%-49s${RESET}${GREEN}|${RESET}\n" "$minio_url"
  printf "${GREEN}|${RESET} Admin email     ${CYAN}%-49s${RESET}${GREEN}|${RESET}\n" "$admin_email"
  printf "${GREEN}|${RESET} Admin username  ${CYAN}%-49s${RESET}${GREEN}|${RESET}\n" "$admin_username"
  printf "${GREEN}|${RESET} Admin password  ${CYAN}%-49s${RESET}${GREEN}|${RESET}\n" "$admin_password"
  printf "${GREEN}|${RESET} Stack name      ${CYAN}%-49s${RESET}${GREEN}|${RESET}\n" "$stack_name"
  printf "${GREEN}|${RESET} Config          %-49s${GREEN}|${RESET}\n" "$ENV_FILE"
  printf "${GREEN}+------------------------------------------------------------------+${RESET}\n"
  printf "${GREEN}|${RESET} ${BOLD}Next steps${RESET}                                                       ${GREEN}|${RESET}\n"
  printf "${GREEN}|${RESET} • Open the Access URL above and login with first admin           ${GREEN}|${RESET}\n"
  printf "${GREEN}|${RESET} • View logs: make prod-logs                                      ${GREEN}|${RESET}\n"
  printf "${GREEN}|${RESET} • Stop stack: make prod-stop                                     ${GREEN}|${RESET}\n"
  printf "${GREEN}|${RESET} • Clean volumes: make prod-clean                                 ${GREEN}|${RESET}\n"
  printf "${GREEN}+------------------------------------------------------------------+${RESET}\n"
}

main() {
  headline "SQLCraft installer (production-first)"
  bootstrap_project_if_needed
  require_cmd docker
  require_cmd openssl
  require_cmd awk
  wait_for_docker

  ensure_env_file
  configure_admin
  configure_domain
  ensure_core_env
  bootstrap_stack
  print_summary
}

main "$@"
