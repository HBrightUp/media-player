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

mkdir -p "${MUSIC_DIRECTORY:-/opt/media-player/music}"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
