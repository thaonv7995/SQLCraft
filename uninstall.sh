#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PWD}"
ENV_FILE=""
COMPOSE_FILE=""
STACK_NAME="${STACK_NAME:-}"
REMOVE_ENV=0
REMOVE_SOURCE=0
CHECK_ONLY=0
SERVICES=(postgres redis minio api web worker worker-query)

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
  --check          Show detected stack resources without removing anything
  --dry-run        Alias for --check
  --purge-env       Remove .env.production after uninstall
  --remove-source   Remove installed source directory (only for ~/.sqlcraft)
  -h, --help        Show help

Examples:
  ./uninstall.sh --check
  ./uninstall.sh
  ./uninstall.sh --purge-env
  bash <(curl -fsSL https://raw.githubusercontent.com/thaonv7995/SQLCraft/main/uninstall.sh) --check
  bash <(curl -fsSL https://raw.githubusercontent.com/thaonv7995/SQLCraft/main/uninstall.sh)
  STACK_NAME=sqlcraft bash <(curl -fsSL https://raw.githubusercontent.com/thaonv7995/SQLCraft/main/uninstall.sh)
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
  if [[ -f "${ROOT_DIR}/docker-compose.prod.yml" ]]; then
    return
  fi

  local candidate candidates=()
  if [[ -n "${SQLCRAFT_INSTALL_DIR:-}" ]]; then
    candidates+=("$SQLCRAFT_INSTALL_DIR")
  fi
  candidates+=("$HOME/.sqlcraft" "/opt/sqlcraft")

  for candidate in "${candidates[@]}"; do
    if [[ -f "${candidate}/docker-compose.prod.yml" ]]; then
      ROOT_DIR="$candidate"
      return
    fi
  done

  ROOT_DIR=""
}

detect_stack_name() {
  if [[ -n "$STACK_NAME" ]]; then
    echo "$STACK_NAME"
    return
  fi

  local candidates count
  candidates="$(
    docker ps -a --format '{{.Names}}' 2>/dev/null \
      | sed -nE 's/^(.*)-(postgres|redis|minio|api|web|worker|worker-query)$/\1/p' \
      | sort -u
  )"

  if grep -qx 'sqlcraft' <<<"$candidates"; then
    echo "sqlcraft"
    return
  fi

  count="$(grep -cve '^[[:space:]]*$' <<<"$candidates" || true)"
  if [[ "$count" -eq 1 ]]; then
    printf "%s\n" "$candidates"
    return
  fi

  if [[ "$count" -gt 1 ]]; then
    warn "Multiple possible SQLCraft stacks found:" >&2
    printf "%s\n" "$candidates" | sed 's/^/  - /' >&2
    warn "Set STACK_NAME=<name> to uninstall a specific stack. Falling back to sqlcraft." >&2
  fi

  echo "sqlcraft"
}

load_paths() {
  if [[ -n "$ROOT_DIR" ]]; then
    COMPOSE_FILE="${ROOT_DIR}/docker-compose.prod.yml"
    ENV_FILE="${ROOT_DIR}/.env.production"
  fi
  if [[ -f "$ENV_FILE" ]]; then
    STACK_NAME="$(get_env_value STACK_NAME "$ENV_FILE")"
  fi
  STACK_NAME="$(detect_stack_name)"
}

stop_stack() {
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    warn "No docker-compose.prod.yml found. Using direct Docker cleanup for stack '${STACK_NAME}'."
    return
  fi

  if [[ -f "$ENV_FILE" ]]; then
    log "Stopping compose stack (${STACK_NAME}) ..."
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down -v || true
  else
    warn "No .env.production found. Trying compose down with defaults."
    docker compose -f "$COMPOSE_FILE" down -v || true
  fi
}

compose_projects_for_stack() {
  local service
  for service in "${SERVICES[@]}"; do
    docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "${STACK_NAME}-${service}" 2>/dev/null || true
  done \
    | grep -v '^<no value>$' \
    | grep -v '^[[:space:]]*$' \
    | sort -u
}

cleanup_stack_artifacts() {
  local network compose_projects project service
  network="${STACK_NAME}-prod"
  compose_projects="$(compose_projects_for_stack || true)"

  log "Cleaning leftover containers for stack: ${STACK_NAME}"
  for service in "${SERVICES[@]}"; do
    docker rm -f "${STACK_NAME}-${service}" >/dev/null 2>&1 || true
  done

  if [[ -n "$compose_projects" ]]; then
    while IFS= read -r project; do
      [[ -z "$project" ]] && continue
      log "Cleaning compose volumes for project: ${project}"
      docker volume ls -q --filter "label=com.docker.compose.project=${project}" \
        | xargs -r docker volume rm -f >/dev/null 2>&1 || true

      log "Cleaning compose networks for project: ${project}"
      docker network ls -q --filter "label=com.docker.compose.project=${project}" \
        | xargs -r docker network rm >/dev/null 2>&1 || true
    done <<<"$compose_projects"
  fi

  log "Cleaning leftover network: ${network}"
  docker network rm "$network" >/dev/null 2>&1 || true
}

stack_containers() {
  local service
  for service in "${SERVICES[@]}"; do
    docker inspect -f '{{ .Name }}  status={{ .State.Status }}  image={{ .Config.Image }}' "${STACK_NAME}-${service}" 2>/dev/null \
      | sed 's#^/##' || true
  done
}

compose_volumes_for_project() {
  local project="$1"
  docker volume ls -q --filter "label=com.docker.compose.project=${project}" 2>/dev/null || true
}

compose_networks_for_project() {
  local project="$1"
  docker network ls --format '{{.Name}}' --filter "label=com.docker.compose.project=${project}" 2>/dev/null || true
}

standalone_networks_for_stack() {
  docker network inspect -f '{{ .Name }}' "${STACK_NAME}-prod" 2>/dev/null || true
}

print_block() {
  local title="$1"
  local value="$2"
  printf "%s:\n" "$title"
  if [[ -n "$value" ]]; then
    printf "%s\n" "$value" | sed 's/^/  - /'
  else
    printf "  (none)\n"
  fi
}

print_check_report() {
  local containers compose_projects project volumes networks standalone_networks
  containers="$(stack_containers || true)"
  compose_projects="$(compose_projects_for_stack || true)"
  standalone_networks="$(standalone_networks_for_stack || true)"

  printf "${BOLD}${CYAN}Detected resources${RESET}\n"
  print_block "Containers" "$containers"
  print_block "Standalone stack network" "$standalone_networks"

  if [[ -n "$compose_projects" ]]; then
    printf "Compose projects:\n"
    printf "%s\n" "$compose_projects" | sed 's/^/  - /'
    while IFS= read -r project; do
      [[ -z "$project" ]] && continue
      volumes="$(compose_volumes_for_project "$project")"
      networks="$(compose_networks_for_project "$project")"
      print_block "Compose volumes (${project})" "$volumes"
      print_block "Compose networks (${project})" "$networks"
    done <<<"$compose_projects"
  else
    print_block "Compose projects" ""
    print_block "Compose volumes" ""
    print_block "Compose networks" ""
  fi

  if [[ -f "$ENV_FILE" ]]; then
    printf "Env file:\n  - %s\n" "$ENV_FILE"
  else
    print_block "Env file" ""
  fi

  if [[ "$REMOVE_ENV" -eq 1 ]]; then
    printf "Requested env purge: yes\n"
  fi
  if [[ "$REMOVE_SOURCE" -eq 1 ]]; then
    printf "Requested source removal: yes\n"
  fi
}

maybe_remove_env() {
  if [[ "$REMOVE_ENV" -eq 1 && -f "$ENV_FILE" ]]; then
    log "Removing ${ENV_FILE}"
    rm -f "$ENV_FILE"
  elif [[ "$REMOVE_ENV" -eq 1 ]]; then
    warn "--purge-env requested, but no .env.production file was found."
  fi
}

maybe_remove_source() {
  if [[ "$REMOVE_SOURCE" -eq 0 ]]; then
    return
  fi
  local default_dir
  default_dir="${SQLCRAFT_INSTALL_DIR:-$HOME/.sqlcraft}"
  if [[ -d "$default_dir" && ( -z "$ROOT_DIR" || "$ROOT_DIR" == "$default_dir" ) ]]; then
    log "Removing source directory: ${default_dir}"
    rm -rf "$default_dir"
  else
    warn "--remove-source is only allowed for ${default_dir}"
  fi
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --check|--dry-run) CHECK_ONLY=1 ;;
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
  if [[ -n "$ROOT_DIR" ]]; then
    printf "Project: %s\n" "$ROOT_DIR"
  else
    printf "Project: %s\n" "not found (standalone Docker cleanup)"
  fi
  printf "Stack:   %s\n\n" "$STACK_NAME"

  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    print_check_report
    printf "\n${BOLD}${GREEN}Check complete. No resources were removed.${RESET}\n"
    exit 0
  fi

  stop_stack
  cleanup_stack_artifacts
  maybe_remove_env
  maybe_remove_source

  printf "\n${BOLD}${GREEN}Uninstall complete.${RESET}\n"
}

main "$@"
