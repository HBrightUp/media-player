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
LOSSLESS_LYRICS_DIRECTORY="${LOSSLESS_LYRICS_DIRECTORY:-${LYRICS_DIRECTORY:-/opt/media-player/lyrics}}"
LOSSY_MUSIC_DIRECTORY="${LOSSY_MUSIC_DIRECTORY:-/opt/media-player/lossy-music}"
LOSSY_LYRICS_DIRECTORY="${LOSSY_LYRICS_DIRECTORY:-/opt/media-player/lossy-lyrics}"
SHARED_LYRICS_DIRECTORY="${SHARED_LYRICS_DIRECTORY:-/opt/media-player/shared-lyrics}"
export LOSSLESS_MUSIC_DIRECTORY LOSSLESS_LYRICS_DIRECTORY LOSSY_MUSIC_DIRECTORY LOSSY_LYRICS_DIRECTORY SHARED_LYRICS_DIRECTORY

mkdir -p "${MUSIC_DIRECTORY:-/opt/media-player/music}"
mkdir -p "${LYRICS_DIRECTORY:-/opt/media-player/lyrics}"
mkdir -p "$LOSSLESS_MUSIC_DIRECTORY"
mkdir -p "$LOSSLESS_LYRICS_DIRECTORY"
mkdir -p "$LOSSY_MUSIC_DIRECTORY"
mkdir -p "$LOSSY_LYRICS_DIRECTORY"
mkdir -p "$SHARED_LYRICS_DIRECTORY"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
