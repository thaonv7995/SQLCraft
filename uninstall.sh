#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PWD}"
ENV_FILE=""
COMPOSE_FILE=""
STACK_NAME=""
REMOVE_ENV=0
REMOVE_SOURCE=0

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

log() { printf "${GREEN}%s${RESET}\n" "$1"; }
warn() { printf "${YELLOW}%s${RESET}\n" "$1"; }
err() { printf "${RED}%s${RESET}\n" "$1"; }

usage() {
  cat <<'EOF'
Usage: ./uninstall.sh [options]

Options:
  --purge-env       Remove .env.production after uninstall
  --remove-source   Remove installed source directory (only for ~/.sqlcraft)
  -h, --help        Show help

Examples:
  ./uninstall.sh
  ./uninstall.sh --purge-env
  SQLCRAFT_INSTALL_DIR=/opt/sqlcraft ./uninstall.sh --remove-source
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Missing required command: $1"
    exit 1
  fi
}

get_env_value() {
  local key="$1"
  local file="$2"
  awk -F= -v k="$key" '$1==k {print $2; exit}' "$file"
}

resolve_root() {
  local candidate
  if [[ -f "${ROOT_DIR}/docker-compose.prod.yml" ]]; then
    return
  fi
  candidate="${SQLCRAFT_INSTALL_DIR:-$HOME/.sqlcraft}"
  if [[ -f "${candidate}/docker-compose.prod.yml" ]]; then
    ROOT_DIR="$candidate"
    return
  fi
  err "Could not locate SQLCraft project directory."
  err "Run this inside project root or set SQLCRAFT_INSTALL_DIR."
  exit 1
}

load_paths() {
  COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
  ENV_FILE="${ROOT_DIR}/.env.production"
  if [[ -f "$ENV_FILE" ]]; then
    STACK_NAME="$(get_env_value STACK_NAME "$ENV_FILE")"
  fi
  STACK_NAME="${STACK_NAME:-sqlcraft}"
}

stop_stack() {
  if [[ -f "$ENV_FILE" ]]; then
    log "Stopping compose stack (${STACK_NAME}) ..."
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down -v || true
  else
    warn "No .env.production found. Trying compose down with defaults."
    docker compose -f "$COMPOSE_FILE" down -v || true
  fi
}

cleanup_stack_artifacts() {
  local pattern network
  pattern="^${STACK_NAME}-(postgres|redis|minio|api|web|worker)$"
  network="${STACK_NAME}-prod"

  log "Cleaning leftover containers for stack: ${STACK_NAME}"
  docker ps -a --format '{{.Names}}' | grep -E "$pattern" | xargs -r docker rm -f >/dev/null 2>&1 || true

  log "Cleaning leftover network: ${network}"
  docker network rm "$network" >/dev/null 2>&1 || true
}

maybe_remove_env() {
  if [[ "$REMOVE_ENV" -eq 1 && -f "$ENV_FILE" ]]; then
    log "Removing ${ENV_FILE}"
    rm -f "$ENV_FILE"
  fi
}

maybe_remove_source() {
  if [[ "$REMOVE_SOURCE" -eq 0 ]]; then
    return
  fi
  local default_dir
  default_dir="${SQLCRAFT_INSTALL_DIR:-$HOME/.sqlcraft}"
  if [[ "$ROOT_DIR" == "$default_dir" ]]; then
    log "Removing source directory: ${ROOT_DIR}"
    rm -rf "$ROOT_DIR"
  else
    warn "--remove-source is only allowed for ${default_dir}"
  fi
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --purge-env) REMOVE_ENV=1 ;;
      --remove-source) REMOVE_SOURCE=1 ;;
      -h|--help) usage; exit 0 ;;
      *)
        err "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
    shift
  done

  require_cmd docker
  resolve_root
  load_paths

  printf "\n${BOLD}${CYAN}SQLCraft uninstall${RESET}\n"
  printf "Project: %s\n" "$ROOT_DIR"
  printf "Stack:   %s\n\n" "$STACK_NAME"

  stop_stack
  cleanup_stack_artifacts
  maybe_remove_env
  maybe_remove_source

  printf "\n${BOLD}${GREEN}Uninstall complete.${RESET}\n"
}

main "$@"

