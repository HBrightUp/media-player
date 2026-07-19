#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/deployments/production/.env"
COMPOSE_FILE="$ROOT_DIR/deployments/production/compose.yaml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  echo "Create it from deployments/production/.env.example and set production values."
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

FRONTEND_MODE="${MEDIA_PLAYER_FRONTEND_MODE:-container}"

if [ "${POSTGRES_PASSWORD:-}" = "change-this-password" ]; then
  echo "Refusing to deploy with the example POSTGRES_PASSWORD."
  exit 1
fi

LOSSLESS_MUSIC_DIRECTORY="${LOSSLESS_MUSIC_DIRECTORY:-${MUSIC_DIRECTORY:-/opt/media-player/music}}"
LOSSLESS_LYRICS_DIRECTORY="${LOSSLESS_LYRICS_DIRECTORY:-${LYRICS_DIRECTORY:-/opt/media-player/lyrics}}"
LOSSY_MUSIC_DIRECTORY="${LOSSY_MUSIC_DIRECTORY:-/opt/media-player/lossy-music}"
LOSSY_LYRICS_DIRECTORY="${LOSSY_LYRICS_DIRECTORY:-/opt/media-player/lossy-lyrics}"
SHARED_LYRICS_DIRECTORY="${SHARED_LYRICS_DIRECTORY:-/opt/media-player/shared-lyrics}"
CLIENT_APPS_DIRECTORY="${CLIENT_APPS_DIRECTORY:-/opt/media-player/apps}"
export LOSSLESS_MUSIC_DIRECTORY LOSSLESS_LYRICS_DIRECTORY LOSSY_MUSIC_DIRECTORY LOSSY_LYRICS_DIRECTORY SHARED_LYRICS_DIRECTORY CLIENT_APPS_DIRECTORY

mkdir -p "${MUSIC_DIRECTORY:-/opt/media-player/music}"
mkdir -p "${LYRICS_DIRECTORY:-/opt/media-player/lyrics}"
mkdir -p "$LOSSLESS_MUSIC_DIRECTORY"
mkdir -p "$LOSSLESS_LYRICS_DIRECTORY"
mkdir -p "$LOSSY_MUSIC_DIRECTORY"
mkdir -p "$LOSSY_LYRICS_DIRECTORY"
mkdir -p "$SHARED_LYRICS_DIRECTORY"
mkdir -p "$CLIENT_APPS_DIRECTORY/android"
mkdir -p "$CLIENT_APPS_DIRECTORY/ios"
mkdir -p "$CLIENT_APPS_DIRECTORY/windows"
mkdir -p "$CLIENT_APPS_DIRECTORY/macos"
mkdir -p "$CLIENT_APPS_DIRECTORY/linux"

MEDIA_PLAYER_FILE_OWNER="${MEDIA_PLAYER_FILE_OWNER:-}"
if [ -z "$MEDIA_PLAYER_FILE_OWNER" ]; then
  if [ -e "$LOSSLESS_MUSIC_DIRECTORY" ]; then
    MEDIA_PLAYER_FILE_OWNER="$(stat -c '%u:%g' "$LOSSLESS_MUSIC_DIRECTORY")"
  else
    MEDIA_PLAYER_FILE_OWNER="1000:1000"
  fi
fi

for directory in \
  "${MUSIC_DIRECTORY:-/opt/media-player/music}" \
  "${LYRICS_DIRECTORY:-/opt/media-player/lyrics}" \
  "$LOSSLESS_MUSIC_DIRECTORY" \
  "$LOSSLESS_LYRICS_DIRECTORY" \
  "$LOSSY_MUSIC_DIRECTORY" \
  "$LOSSY_LYRICS_DIRECTORY" \
  "$SHARED_LYRICS_DIRECTORY" \
  "$CLIENT_APPS_DIRECTORY" \
  "$CLIENT_APPS_DIRECTORY/android" \
  "$CLIENT_APPS_DIRECTORY/ios" \
  "$CLIENT_APPS_DIRECTORY/windows" \
  "$CLIENT_APPS_DIRECTORY/macos" \
  "$CLIENT_APPS_DIRECTORY/linux"; do
  chown "$MEDIA_PLAYER_FILE_OWNER" "$directory"
done

DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-0}"
COMPOSE_DOCKER_CLI_BUILD="${COMPOSE_DOCKER_CLI_BUILD:-0}"
export DOCKER_BUILDKIT COMPOSE_DOCKER_CLI_BUILD

if [ "$FRONTEND_MODE" = "host_caddy" ]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build postgres redis backend
  docker rm -f media-player-frontend >/dev/null 2>&1 || true

  docker build -t production-frontend:latest "$ROOT_DIR/frontend"
  container_id="$(docker create production-frontend:latest)"
  cleanup() {
    docker rm "$container_id" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT INT TERM

  rm -rf "$ROOT_DIR/frontend/dist.new" "$ROOT_DIR/frontend/dist.prev"
  docker cp "$container_id":/srv "$ROOT_DIR/frontend/dist.new"
  cleanup
  trap - EXIT INT TERM

  if [ -d "$ROOT_DIR/frontend/dist" ]; then
    mv "$ROOT_DIR/frontend/dist" "$ROOT_DIR/frontend/dist.prev"
  fi
  mv "$ROOT_DIR/frontend/dist.new" "$ROOT_DIR/frontend/dist"

  if command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ]; then
    caddy validate --config /etc/caddy/Caddyfile
    if command -v systemctl >/dev/null 2>&1; then
      systemctl reload caddy
    fi
  fi
else
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build
fi
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
