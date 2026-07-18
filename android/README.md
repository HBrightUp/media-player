# HML Media Player Android

这是媒体播放器系统的 Android 原生客户端。它只和后端 API 通信，不复用 Web 端实现，也不包含 Web 端的云文档/音乐文件管理能力。

当前第一阶段已覆盖：

- 登录、读取当前用户
- 曲库列表：高品质/轻音乐切换
- 高品质 FLAC 播放：优先播放 APP 本地缓存，未缓存时通过后端播放会话和 `stream_ticket` 播放原始流
- KTV 歌词显示：优先使用后端返回的逐字时间轴
- “我的”页面：缓存容量设置、缓存清理

## 本地运行

用 Android Studio 打开 `android/` 目录并同步 Gradle。

默认后端地址是模拟器访问宿主机的：

```bash
http://10.0.2.2:9000
```

构建时可以覆盖后端地址：

```bash
./gradlew :app:assembleDebug -PapiBaseUrl=http://47.112.188.195
```

也可以在 APP 登录页直接修改后端地址。

## 设计边界

- Android APP 专注播放器体验：曲库、播放、歌词、缓存、用户个人页。
- Android 不做管理功能；用户管理、音乐文件管理都交给 Web 端。
- 不做音乐文件上传、重命名、删除、目录配置、扫描。
- 不做 Web 端云文档功能。
- FLAC 本地缓存只在用户有高品质播放权限时使用；本地缓存不会绕过后端权限。

## 后续建议

- 把当前 Activity 内播放控制完全切到 `MediaController + MediaSessionService`，增强后台、锁屏、车机和蓝牙控制。
- 增加缓存队列、仅 Wi-Fi 缓存、按歌单自动缓存。
- 增加更细的 KTV 逐字填充动画，而不是当前第一阶段的逐字高亮。
