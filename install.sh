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

ensure_core_env() {
  ensure_or_generate_secret "JWT_SECRET" 32
  ensure_or_generate_secret "POSTGRES_PASSWORD" 16
  ensure_or_generate_secret "MINIO_ROOT_PASSWORD" 16
  ensure_or_generate_secret "STORAGE_SECRET_KEY" 16
  ensure_or_generate_secret "SANDBOX_DB_PASSWORD" 16

  local postgres_password
  postgres_password="$(get_env_value "POSTGRES_PASSWORD" "$ENV_FILE")"

  set_env_value "DATABASE_URL" "postgresql://sqlcraft:${postgres_password}@postgres:5432/sqlcraft" "$ENV_FILE"
  set_env_value "NEXT_PUBLIC_APP_URL" "http://localhost:13029" "$ENV_FILE"
  set_env_value "ALLOWED_ORIGINS" "http://localhost:13029" "$ENV_FILE"
  set_env_value "NEXT_PUBLIC_API_URL" "http://localhost:4000/v1" "$ENV_FILE"
  set_env_value "WEB_PORT" "13029" "$ENV_FILE"
}

wait_for_docker() {
  if ! docker info >/dev/null 2>&1; then
    error "Docker daemon is not running. Please start Docker Desktop / dockerd."
    exit 1
  fi
}

run_compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

bootstrap_stack() {
  headline "Bootstrapping infrastructure"
  run_compose up -d --build postgres redis minio

  headline "Running migrations + seed"
  run_compose run --rm --entrypoint sh api -lc \
    "pnpm --filter @sqlcraft/api exec drizzle-kit migrate && pnpm --filter @sqlcraft/api db:seed"

  headline "Starting API + Web + Worker"
  run_compose up -d --build api web worker
}

print_summary() {
  local admin_email admin_username admin_password
  admin_email="$(get_env_value "FIRST_ADMIN_EMAIL" "$ENV_FILE")"
  admin_username="$(get_env_value "FIRST_ADMIN_USERNAME" "$ENV_FILE")"
  admin_password="$(get_env_value "FIRST_ADMIN_PASSWORD" "$ENV_FILE")"
  local access_url api_url minio_url
  access_url="http://localhost:13029"
  api_url="http://localhost:4000"
  minio_url="http://localhost:9001"

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
  ensure_core_env
  bootstrap_stack
  print_summary
}

main "$@"
