.PHONY: dev-db backend frontend fmt test

dev-db:
	docker compose -f deployments/local/compose.yaml up -d

backend:
	cd backend && DATABASE_URL='postgres://media_player:media_player@127.0.0.1:15432/media_player?sslmode=disable' go run ./cmd/server

frontend:
	cd frontend && npm run dev

fmt:
	cd backend && gofmt -w .
	cd frontend && npm run typecheck

test:
	cd backend && go test ./...
	cd frontend && npm run build
