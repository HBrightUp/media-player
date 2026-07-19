# Production Deployment

This setup is intended for a single Alibaba Cloud ECS instance running Docker
Compose. Production is runtime-only: build backend images and frontend static
assets outside the server, then upload artifacts into `/opt/media-player`.
It starts these runtime services:

- `backend`: Go API server
- `postgres`: PostgreSQL data store
- `redis`: runtime cache for playback sessions and stream tickets

Static frontend files are served by the host Caddy from
`/opt/media-player/frontend/dist`.

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

## 2. Upload Runtime Files

Create the runtime directory on the server:

```bash
sudo mkdir -p /opt/media-player
sudo chown -R "$USER":"$USER" /opt/media-player
```

Do not clone the repository or build source code on production. Upload only:

```text
/opt/media-player/deployments/production/.env
/opt/media-player/deployments/production/compose.yaml
/opt/media-player/deployments/production/Caddyfile.media-player
/opt/media-player/frontend/dist/
```

Build the backend image on a build machine, copy the image tarball to
production, and load it with:

```bash
docker load -i production-backend.tar
```

## 3. Configure Production Env

```bash
cp deployments/production/.env.example deployments/production/.env
```

Edit `deployments/production/.env`:

```dotenv
MEDIA_PLAYER_SITE_ADDRESS=media.example.com
MEDIA_PLAYER_PUBLIC_ORIGIN=https://media.example.com
BACKEND_IMAGE=production-backend:latest
POSTGRES_DB=media_player
POSTGRES_USER=media_player
POSTGRES_PASSWORD=<use-a-strong-password>
REDIS_KEY_PREFIX=media-player
MUSIC_DIRECTORY=/opt/media-player/music
LOSSLESS_MUSIC_DIRECTORY=/opt/media-player/music
LOSSY_MUSIC_DIRECTORY=/opt/media-player/lossy-music
SHARED_LYRICS_DIRECTORY=/opt/media-player/shared-lyrics
CLIENT_APPS_DIRECTORY=/opt/media-player/apps
```

`MUSIC_DIRECTORY` remains as a legacy alias for `LOSSLESS_MUSIC_DIRECTORY`.
Lyrics are maintained only in `SHARED_LYRICS_DIRECTORY`, shared by lossless and
lossy audio versions.

For IP-only HTTP deployment:

```dotenv
MEDIA_PLAYER_SITE_ADDRESS=http://<ECS_PUBLIC_IP>
MEDIA_PLAYER_PUBLIC_ORIGIN=http://<ECS_PUBLIC_IP>
```

The deploy script starts only `postgres`, `redis`, and `backend` through
Compose, validates `/etc/caddy/Caddyfile` when Caddy is installed, and reloads
the system Caddy service. It never builds on production.

## 4. Add Music Files

```bash
mkdir -p /opt/media-player/music
mkdir -p /opt/media-player/lossy-music
mkdir -p /opt/media-player/shared-lyrics
```

Upload lossless audio files into `/opt/media-player/music`, lossy audio files
into `/opt/media-player/lossy-music`, and all lyrics into
`/opt/media-player/shared-lyrics`. Use the same relative path where possible,
for example:

```text
/opt/media-player/music/artist/song.flac
/opt/media-player/lossy-music/artist/song.mp3
/opt/media-player/shared-lyrics/artist/song.lrc
/opt/media-player/shared-lyrics/artist/song.karaoke.json
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

Run from the runtime root on the server after the backend image and
`frontend/dist` have already been uploaded:

```bash
sh deployments/production/deploy.sh
```

The script validates the environment file, creates the configured music,
shared lyrics, and client installer directories, verifies the backend image and
frontend artifact exist, and starts runtime services.

Manual equivalent:

```bash
docker compose \
  --env-file deployments/production/.env \
  -f deployments/production/compose.yaml \
  up -d postgres redis backend
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
- Use `deployments/production/Caddyfile.media-player` with the host Caddy setup
  to serve `/opt/media-player/frontend/dist` and proxy `/api/*` to the backend.
- Database data is stored in Docker volume `media_player_pgdata`.
- Redis runtime data is stored in Docker volume `media_player_redisdata`.
