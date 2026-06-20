# Media Player

一个移动端布局优先的在线音乐播放器：React 前端、Go 后端、Postgres 数据库。

> 参考站点 `https://m.uzz.me/` 当前会进入安全验证页，无法直接读取真实页面结构。本实现已调整为 Web 端全屏播放器：纯黑/深灰界面、单一橙红强调色、纯色封面与底部固定播放控制。

## 功能

- 通过 `config.yaml` 设置服务端可访问的默认音乐文件夹目录
- 后端启动时递归扫描目录下的常见音频文件，包括 `mp3`、`flac`、`m4a`、`wav` 等
- 后端检测音乐/歌词目录变化，变化后防抖触发音乐库扫描
- 保存歌曲文件信息到 Postgres
- 读取音频文件的基础标签信息：标题、歌手、专辑
- 支持独立 `.lrc` 歌词目录，播放时按歌曲 ID 加载并同步显示歌词
- 歌曲列表搜索、排序、选中播放
- 后端按歌曲 ID 提供音频流

## 本地启动

1. 启动 Postgres：

```bash
docker compose -f deployments/local/compose.yaml up -d
```

2. 设置默认音乐目录：

编辑根目录 [config.yaml](/Users/hml/project/myself/github/media-player/config.yaml)，填入本机音乐目录：

```yaml
library:
  music_directory: "/Users/you/Music"
  lyrics_directory: "/Users/you/MusicLyrics"
  watch_poll_interval: "1m"
  watch_debounce: "30s"
```

3. 启动后端：

```bash
cd backend
DATABASE_URL='postgres://media_player:media_player@127.0.0.1:15432/media_player?sslmode=disable' go run ./cmd/server
```

歌词目录是可选项。推荐按音乐目录的相对路径放置同名 `.lrc` 文件，例如：

```text
/Users/you/Music/陈奕迅/爱情转移.flac
/Users/you/MusicLyrics/陈奕迅/爱情转移.lrc
```

后端会在启动时扫描音乐目录下的音频文件，并把找到的歌词写入独立的 `track_lyrics` 表。启动后默认每 1 分钟检测一次音乐/歌词目录变化，发现变化后等待 30 秒安静期再扫描，避免大文件复制或批量上传时反复扫描。需要关闭目录变化检测时可设置 `LIBRARY_WATCH_POLL_INTERVAL=0`；自动全量扫描是可选兜底能力，默认关闭，需要时可设置 `LIBRARY_AUTO_SCAN_INTERVAL=30m`。

4. 启动前端：

```bash
cd frontend
npm install
npm run dev
```

前端开发服务会监听 `0.0.0.0:5173`。本机可打开 `http://localhost:5173`，同一局域网设备请打开 `http://<本机局域网 IP>:5173`。

## API

- `GET /healthz`
- `GET /api/settings/library`
- `PUT /api/settings/library` body: `{ "path": "/path/to/music" }`
- `POST /api/library/scan`
- `GET /api/tracks`
- `GET /api/tracks/{id}/lyrics`
- `GET /api/tracks/{id}/stream`

## 目录说明

- `frontend/`: React + Vite + TypeScript 前端
- `backend/`: Go API 服务
- `backend/migrations/`: Postgres 初始化 SQL
- `deployments/local/`: 本地 Postgres Compose 配置
- `docs/music-player-concept.png`: 本次视觉概念稿
