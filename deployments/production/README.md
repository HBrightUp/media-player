# Production Deployment

This setup is intended for a single Alibaba Cloud ECS instance running Docker
Compose. It starts three services:

- `frontend`: Caddy serving the React build and proxying API requests
- `backend`: Go API server
- `postgres`: PostgreSQL data store

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
POSTGRES_DB=media_player
POSTGRES_USER=media_player
POSTGRES_PASSWORD=<use-a-strong-password>
MUSIC_DIRECTORY=/opt/media-player/music
```

For IP-only HTTP deployment:

```dotenv
MEDIA_PLAYER_SITE_ADDRESS=http://<ECS_PUBLIC_IP>
MEDIA_PLAYER_PUBLIC_ORIGIN=http://<ECS_PUBLIC_IP>
```

## 4. Add Music Files

```bash
mkdir -p /opt/media-player/music
```

Upload `.mp3` files, plus optional same-name `.lrc` lyric files, into
`/opt/media-player/music`.

## 5. Deploy

Run from the repository root on the server:

```bash
sh deployments/production/deploy.sh
```

The script validates the environment file, creates the music directory, builds
the frontend/backend images, and starts all services.

Manual equivalent:

```bash
docker compose \
  --env-file deployments/production/.env \
  -f deployments/production/compose.yaml \
  up -d --build
```

## 6. Verify

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
- Caddy certificate/config data is stored in Docker volumes
  `media_player_caddy_data` and `media_player_caddy_config`.
