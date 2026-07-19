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

if [ "${POSTGRES_PASSWORD:-}" = "change-this-password" ]; then
  echo "Refusing to deploy with the example POSTGRES_PASSWORD."
  exit 1
fi

LOSSLESS_MUSIC_DIRECTORY="${LOSSLESS_MUSIC_DIRECTORY:-${MUSIC_DIRECTORY:-/opt/media-player/music}}"
LOSSY_MUSIC_DIRECTORY="${LOSSY_MUSIC_DIRECTORY:-/opt/media-player/lossy-music}"
SHARED_LYRICS_DIRECTORY="${SHARED_LYRICS_DIRECTORY:-/opt/media-player/shared-lyrics}"
CLIENT_APPS_DIRECTORY="${CLIENT_APPS_DIRECTORY:-/opt/media-player/apps}"
export LOSSLESS_MUSIC_DIRECTORY LOSSY_MUSIC_DIRECTORY SHARED_LYRICS_DIRECTORY CLIENT_APPS_DIRECTORY

mkdir -p "${MUSIC_DIRECTORY:-/opt/media-player/music}"
mkdir -p "$LOSSLESS_MUSIC_DIRECTORY"
mkdir -p "$LOSSY_MUSIC_DIRECTORY"
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
  "$LOSSLESS_MUSIC_DIRECTORY" \
  "$LOSSY_MUSIC_DIRECTORY" \
  "$SHARED_LYRICS_DIRECTORY" \
  "$CLIENT_APPS_DIRECTORY" \
  "$CLIENT_APPS_DIRECTORY/android" \
  "$CLIENT_APPS_DIRECTORY/ios" \
  "$CLIENT_APPS_DIRECTORY/windows" \
  "$CLIENT_APPS_DIRECTORY/macos" \
  "$CLIENT_APPS_DIRECTORY/linux"; do
  chown "$MEDIA_PLAYER_FILE_OWNER" "$directory"
done

BACKEND_IMAGE="${BACKEND_IMAGE:-production-backend:latest}"
export BACKEND_IMAGE

if ! docker image inspect "$BACKEND_IMAGE" >/dev/null 2>&1; then
  echo "Missing backend image: $BACKEND_IMAGE"
  echo "Build it outside production, upload it to the server, then run docker load."
  exit 1
fi

if [ ! -f "$ROOT_DIR/frontend/dist/index.html" ]; then
  echo "Missing frontend artifact: $ROOT_DIR/frontend/dist/index.html"
  echo "Build frontend outside production and upload frontend/dist before deploying."
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate --no-deps backend
docker rm -f media-player-frontend >/dev/null 2>&1 || true

if command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ]; then
  caddy validate --config /etc/caddy/Caddyfile
  if command -v systemctl >/dev/null 2>&1; then
    systemctl reload caddy
  fi
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
