# Production Deployment

This setup is intended for a single Alibaba Cloud ECS instance running Docker
Compose. It starts three services:

- `frontend`: Caddy serving the React build and proxying API requests
- `backend`: Go API server
- `postgres`: PostgreSQL data store
- `redis`: runtime cache for playback sessions and stream tickets

## 1. Prepare ECS

Recommended server target path:

```bash
/opt/media-player
```

Open these Alibaba Cloud security group inbound ports:

- `22/tcp` for SSH
- `80/tcp` for HTTP and ACME challenge
- `443/tcp` for HTTPS

If you have a domain, add an `A` record pointing it to the ECS public IP. If you
do not have a domain yet, deploy with `http://<ECS_PUBLIC_IP>` first.

Install Docker and the Docker Compose plugin on the server before deploying.

## 2. Upload Code

Clone or upload this repository to the server:

```bash
sudo mkdir -p /opt/media-player
sudo chown -R "$USER":"$USER" /opt/media-player
git clone <your-repo-url> /opt/media-player
cd /opt/media-player
```

If you upload a local working tree instead of cloning, keep the same target path.

## 3. Configure Production Env

```bash
cp deployments/production/.env.example deployments/production/.env
```

Edit `deployments/production/.env`:

```dotenv
MEDIA_PLAYER_SITE_ADDRESS=media.example.com
MEDIA_PLAYER_PUBLIC_ORIGIN=https://media.example.com
MEDIA_PLAYER_FRONTEND_MODE=container
POSTGRES_DB=media_player
POSTGRES_USER=media_player
POSTGRES_PASSWORD=<use-a-strong-password>
REDIS_KEY_PREFIX=media-player
MUSIC_DIRECTORY=/opt/media-player/music
LYRICS_DIRECTORY=/opt/media-player/lyrics
LOSSLESS_MUSIC_DIRECTORY=/opt/media-player/music
LOSSLESS_LYRICS_DIRECTORY=/opt/media-player/lyrics
LOSSY_MUSIC_DIRECTORY=/opt/media-player/lossy-music
LOSSY_LYRICS_DIRECTORY=/opt/media-player/lossy-lyrics
SHARED_LYRICS_DIRECTORY=/opt/media-player/shared-lyrics
CLIENT_APPS_DIRECTORY=/opt/media-player/apps
```

`MUSIC_DIRECTORY` and `LYRICS_DIRECTORY` remain as legacy aliases. The default
production mapping keeps existing files compatible by treating
`/opt/media-player/music` as lossless music and `/opt/media-player/lyrics` as
lossless lyrics.

For IP-only HTTP deployment:

```dotenv
MEDIA_PLAYER_SITE_ADDRESS=http://<ECS_PUBLIC_IP>
MEDIA_PLAYER_PUBLIC_ORIGIN=http://<ECS_PUBLIC_IP>
```

If ports `80`/`443` are already owned by a system Caddy, set:

```dotenv
MEDIA_PLAYER_FRONTEND_MODE=host_caddy
```

In this mode the deploy script starts only `postgres` and `backend` through
Compose, builds the frontend image, exports its `/srv` static files into
`/opt/media-player/frontend/dist`, validates `/etc/caddy/Caddyfile`, and reloads
the system Caddy service.

## 4. Add Music Files

```bash
mkdir -p /opt/media-player/music
mkdir -p /opt/media-player/lyrics
mkdir -p /opt/media-player/lossy-music
mkdir -p /opt/media-player/lossy-lyrics
mkdir -p /opt/media-player/shared-lyrics
```

Upload lossless audio files into `/opt/media-player/music` and lossless lyrics
into `/opt/media-player/lyrics`. Upload lossy audio files into
`/opt/media-player/lossy-music` and lossy lyrics into
`/opt/media-player/lossy-lyrics`. Lyrics shared by both versions can be placed
in `/opt/media-player/shared-lyrics`. Use the same relative path where
possible, for example:

```text
/opt/media-player/music/artist/song.flac
/opt/media-player/lyrics/artist/song.lrc
/opt/media-player/lossy-music/artist/song.mp3
/opt/media-player/lossy-lyrics/artist/song.lrc
/opt/media-player/shared-lyrics/artist/song.lrc
```

## 5. Add Client Installers

Client installers are served by the backend from `CLIENT_APPS_DIRECTORY`, with
one subdirectory per platform:

```text
/opt/media-player/apps/android/media-player-v0.1.0.apk
/opt/media-player/apps/ios/
/opt/media-player/apps/windows/
/opt/media-player/apps/macos/
/opt/media-player/apps/linux/
```

The web “我 / 客户端” page reads `/api/client-apps`. For Android, the backend
automatically selects the latest `media-player-v*.apk` under the `android`
folder and exposes `/api/client-apps/android/download`.

## 6. Deploy

Run from the repository root on the server:

```bash
sh deployments/production/deploy.sh
```

The script validates the environment file, creates the configured music and
lyrics directories, builds the frontend/backend images, and starts all services.

Manual equivalent:

```bash
docker compose \
  --env-file deployments/production/.env \
  -f deployments/production/compose.yaml \
  up -d --build
```

## 7. Verify

```bash
docker compose --env-file deployments/production/.env -f deployments/production/compose.yaml ps
curl -i "$(grep MEDIA_PLAYER_PUBLIC_ORIGIN deployments/production/.env | cut -d= -f2)/healthz"
```

Open `MEDIA_PLAYER_PUBLIC_ORIGIN` in a browser.

## Notes

- Caddy requests and renews HTTPS certificates automatically when
  `MEDIA_PLAYER_SITE_ADDRESS` is a real domain and DNS points to the server.
- If ports `80` or `443` are already occupied by another web server, stop it or
  use `deployments/production/Caddyfile.media-player` with your existing host
  Caddy setup instead of the bundled `frontend` service.
- Database data is stored in Docker volume `media_player_pgdata`.
- Redis runtime data is stored in Docker volume `media_player_redisdata`.
- Caddy certificate/config data is stored in Docker volumes
  `media_player_caddy_data` and `media_player_caddy_config`.
