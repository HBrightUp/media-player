# Production Deployment

Recommended target path on the server:

```bash
/opt/media-player
```

Required server ports:

- `22/tcp` for SSH
- `80/tcp` for Caddy HTTP challenge and redirect
- `443/tcp` for HTTPS

Required DNS:

```text
media.hbrightup.fun -> ECS public IP
```

Create the production environment file:

```bash
cp deployments/production/.env.example deployments/production/.env
```

Edit `.env` and set a strong `POSTGRES_PASSWORD`.

Create the music directory:

```bash
mkdir -p /opt/media-player/music
```

Upload `.mp3` and optional same-name `.lrc` files into `/opt/media-player/music`.

Build the frontend assets:

```bash
cd frontend
npm ci
npm run build
cd ..
```

Start the backend stack:

```bash
docker compose -f deployments/production/compose.yaml --env-file deployments/production/.env up -d --build
```

Install the Caddy site into the existing server Caddyfile:

```bash
cat deployments/production/Caddyfile.media-player >> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy will serve the frontend from `/opt/media-player/frontend/dist`, proxy `/api/*` and `/healthz` to the backend at `127.0.0.1:18080`, and request HTTPS automatically for the configured domain.
