# Media Player

一个面向个人或小团队自托管的媒体与文档应用。前端使用 React、Vite 和 TypeScript，后端使用 Go，数据保存在 PostgreSQL，音频和歌词保留在服务器文件系统。

## 主要功能

- 分别管理无损和有损曲库，支持共享歌词目录
- 扫描 MP3、FLAC、M4A、AAC、OGG、WAV、AIFF 等音频
- 读取音频标题、歌手、专辑、内嵌封面和内嵌歌词
- 匹配独立 LRC/TXT 歌词并同步滚动显示
- 收藏、收藏分类、搜索、排序、播放队列、均衡器和睡眠定时
- 账号登录、角色权限、登录审计、在线状态和单账号播放会话控制
- 管理员上传、转码、重命名和删除服务器音频/歌词
- 基于 Tiptap 的共享文档与目录管理
- PWA 安装、Windows 局域网启动和 Docker Compose 生产部署

## 权限模型

| 角色 | 有损播放 | 无损播放 | 音频文件管理 | 用户管理 |
| --- | --- | --- | --- | --- |
| 普通用户 | 是 | 否 | 否 | 否 |
| VIP | 是 | 是 | 否 | 否 |
| 管理员 | 是 | 是 | 是 | 否 |
| 超级管理员 | 是 | 是 | 是 | 是 |

所有播放、歌词、在线状态和文档读取均要求登录。音频流地址只包含受当前播放会话约束的临时票据，不包含登录令牌。

## 本地启动

要求：Go 1.26、Node.js 24、Docker（用于本地 PostgreSQL 和 Redis）。

1. 启动 PostgreSQL 和 Redis：

```bash
docker compose -f deployments/local/compose.yaml up -d
```

Redis 默认暴露在 `127.0.0.1:16379`，用于播放会话、stream ticket 等短生命周期状态；音频文件不会写入 Redis。

2. 配置曲库。可以编辑根目录 `config.yaml`，也可以复制 `.env.example` 后按环境注入变量：

```yaml
library:
  shared_lyrics_directory: "/Users/you/MusicLyricsShared"
  lossless:
    music_directory: "/Users/you/MusicLossless"
    lyrics_directory: "/Users/you/MusicLyricsLossless"
  lossy:
    music_directory: "/Users/you/MusicLossy"
    lyrics_directory: "/Users/you/MusicLyricsLossy"
  watch_poll_interval: "1m"
  watch_debounce: "30s"
  auto_scan_interval: "0"
```

歌词优先按相对目录和同名文件匹配，例如：

```text
/Users/you/MusicLossless/陈奕迅/爱情转移.flac
/Users/you/MusicLyricsLossless/陈奕迅/爱情转移.lrc
```

3. 启动后端：

```bash
cd backend
go run ./cmd/server
```

4. 启动前端：

```bash
cd frontend
npm ci
npm run dev
```

访问 `http://localhost:5173`。前端开发服务会把 `/api` 和 `/healthz` 代理到 `127.0.0.1:9000`。

Windows 可以运行 `scripts/start-lan.ps1`；首次开放防火墙时使用管理员 PowerShell 执行 `scripts/start-lan.ps1 -OpenFirewall`。

## 曲库扫描安全

扫描按曲库根目录独立对账。只有某个根目录完整遍历成功后，才会清理该根目录下已经不存在的数据库记录；其他曲库或临时不可访问的挂载不会被清理。音频文件本身不会在扫描过程中删除。

后端会先启动 HTTP 服务，再在后台执行首次曲库扫描，因此大曲库不会阻塞 `/healthz` 和登录接口；扫描期间曲目列表会逐步更新。

## 常用 API

- `GET /healthz`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET|POST /api/admin/users`
- `PATCH|DELETE /api/admin/users/{id}`
- `POST /api/presence/heartbeat`
- `POST /api/presence/offline`
- `POST /api/playback/session`
- `POST /api/playback/heartbeat`
- `POST /api/playback/release`
- `GET /api/tracks?quality=lossless|lossy`
- `GET /api/tracks/{id}/lyrics`
- `GET /api/tracks/{id}/cover`
- `GET /api/tracks/{id}/stream?stream_ticket=...`
- `GET|POST /api/favorites`
- `GET|POST /api/favorite-categories`
- `GET|POST /api/note-folders`
- `GET|POST /api/notes`
- `POST /api/audio-files/authorize`
- `GET /api/audio-files`
- `POST /api/audio-files/import`

公开注册当前关闭，用户由超级管理员在用户管理页面创建。

## 测试

```bash
make test
```

该命令运行后端 Go 测试以及前端 TypeScript/生产构建。GitHub Actions 也会执行相同的两部分检查。

## 部署

生产部署使用 Caddy、Go 后端和 PostgreSQL 三个容器。完整步骤见 `deployments/production/README.md`。

后端启动时执行嵌入的 `backend/internal/database/schema.sql`；`backend/migrations/001_init.sql` 与其保持功能一致，供外部迁移流程使用。
生产 Compose 会同时启动 Redis，后端默认通过 `redis:6379` 使用它来存储播放运行态数据。

## 目录

- `frontend/`：React SPA/PWA
- `backend/cmd/server/`：后端入口
- `backend/internal/httpapi/`：HTTP API、认证与权限
- `backend/internal/library/`：扫描、标签、歌词与目录监听
- `backend/internal/database/`：PostgreSQL 数据访问和运行时 schema
- `deployments/local/`：本地 PostgreSQL
- `deployments/production/`：生产 Docker Compose 和 Caddy
