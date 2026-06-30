# MusicLI

> 拟终端风格本地音乐播放器 | Pseudo-CLI Local Music Player

[中文](#中文) | [English](#english)


## 中文

### 简介

MusicLI 是一款**拟终端命令行风格**的桌面音乐播放器，使用 Tauri v2 + Rust + React + TypeScript 构建。音频引擎基于 Symphonia 解码 + cpal 输出，支持 WASAPI（共享/默认）和 ASIO（独占）模式。支持 MP3/FLAC/WAV/OGG/M4A 等格式、ID3 元数据解析、LRC 歌词显示（终端内嵌 + 透明悬浮桌面歌词）、主题系统和歌单分享。

**v3.3 新增：28 个端点的 HTTP REST API、Headless 无 GUI 服务端。**

### 特性

- **命令行风格界面** — 键入命令控制一切，方向键历史

- **Rust 音频引擎** — Symphonia 解码 → rubato 重采样 → cpal 输出，支持 WASAPI/ASIO

- **多种播放模式** — 顺序 / 单曲循环 / 列表循环 / 随机

- **HTTP REST API** — 28 个端点，播放控制、歌单 CRUD、文件浏览、元数据、歌词、配置、同步（支持 CORS）

- **Headless 模式** — 零 GUI 依赖的纯二进制（`musicli --remote`），可部署为服务端

- **LRC 歌词** — 终端内嵌 + 透明悬浮桌面歌词，竖排/横排、颜色/大小/阴影/对齐全可配

- **子目录歌词检索** — 递归搜索音乐文件夹和 MP3 父目录

- **歌词时序偏移** — 每首歌独立调整 LRC 偏移，自动保存

- **歌单管理** — 创建/编辑/切换歌单，批量导入，模糊搜索

- **元数据展示** — ID3 标签，显示专辑、年份、码率等

- **主题系统** — 内置暗色 / Claude Desktop 主题，支持导入导出

- **外观定制** — 自定义字体、背景图片、模糊度、进度条、窗口圆角

- **三语言** — 简体中文 / English / 日本語

- **跨平台** — Windows / Linux / macOS

- **歌单分享 (Sync)** — ZIP 打包（音频 + LRC + 元数据），跨设备导入

- **配置持久化** — JSON 文件存储在音乐文件夹 `config/` 目录下，可手动编辑

### 安装

从 [Releases](file:///home/kirarineko/releases) 下载对应平台包：

| 平台 | 文件 | 说明 |
| - | - | - |
| **Windows** | `musicli-windows.zip` | exe + MSI 安装包 |
| **Linux (GUI)** | `musicli-linux.zip` | deb + rpm 安装包 |
| **Linux (Headless)** | `musicli-headless-linux.zip` | 纯二进制，无 GUI/WebKit 依赖 |


**Headless 模式**（服务端部署）：

```
chmod +x musicli  
./musicli --remote              # 默认绑 0.0.0.0:52013（占用则自动+1）  
./musicli --remote --port 8080 # 指定端口  
echo $MUSICLI_HTTP_PORT         # 查看端口号
```

### 从源码构建

**前置要求**

- [Rust 工具链](https://rustup.rs/)

- [LLVM/Clang](https://github.com/llvm/llvm-project/releases) — ASIO SDK 编译需要（Windows）

- [Node.js](https://nodejs.org/) 22+

- [pnpm](https://pnpm.io/)

```
git clone https://github.com/Kirarineko/MusicLI.git  
cd MusicLI  
pnpm install  
  
# 开发模式（仅前端，无原生 IPC）  
pnpm dev  
  
# 完整 Tauri 开发（启动 Vite + Tauri 窗口）  
pnpm tauri dev  
  
# 生产构建  
pnpm tauri build  
  
# Headless 二进制（无 GUI 依赖）  
cargo build --bin musicli --no-default-features --release
```

### HTTP API

MusiCLI 启动时自动在后台运行 HTTP server（GUI 和 Headless 模式均可用）。28 个端点覆盖全部功能，支持 CORS 跨域。

```
# 查看 API 端口  
echo $MUSICLI_HTTP_PORT  
# 或 GUI 中输入: remote status  
  
# cURL 示例  
curl http://127.0.0.1:PORT/status          # 播放状态  
curl -X POST http://127.0.0.1:PORT/play -H 'Content-Type: application/json' -d '{}'  
curl -X POST http://127.0.0.1:PORT/next  
curl "http://127.0.0.1:PORT/files?dir=/home/user/Music"
```

- **播放控制**: `/status`, `/play`, `/pause`, `/stop`, `/next`, `/prev`, `/seek`, `/volume`

- **音频模式**: `/audio-mode`, `/play-mode`, `/devices`

- **歌单**: `/playlist`, `/playlists`, `/playlists/single`, `/playlists/switch`, `/playlists/refresh`

- **文件/元数据**: `/files`, `/metadata`, `/files/read`

- **歌词**: `/lyrics`, `/lyrics/parse`, `/lyrics/offsets`

- **配置/同步**: `/config`, `/folder`, `/sync/export`, `/sync/import`

详细文档见 [API.md](file:///home/kirarineko/codes/MusiCLI/API.md)。

### 命令

#### 文件

| 命令 | 说明 |
| - | - |
| `open` | 选择音频文件 |
| `folder` / `open dir` | 打开文件夹加载全部音频 |
| `import` | 导入至歌单（搜索 + 多选） |


#### 播放

| 命令 | 说明 |
| - | - |
| `play [n|name]` | 播放 / 恢复（模糊搜索） |
| `pause` / `stop` | 暂停 / 停止 |
| `next` / `prev` | 下一首 / 上一首 |
| `mode` | 循环模式 |
| `vol <0-100>` | 音量 |
| `seek [sec]` | 跳转；无参数进入方向键模式 |
| `bar` | 进度条 |
| `audio mode [normal|asio]` | 音频输出模式 |
| `audio devices` | 列出音频设备 |


#### 歌词

| 命令 | 说明 |
| - | - |
| `lyric t` | 切换终端歌词 |
| `lyric f` | 切换悬浮歌词 |
| `lyric off` | 关闭全部 |
| `lyric accent|fg <#hex>` | 当前行/后续行颜色 |
| `lyric next <0-10>` | 后续行数 |
| `lyric gap <px>` | 行间距 |
| `lyric shadow <off|s|m|l>` | 文字阴影 |
| `lyric align <l|c|r>` | 对齐 |
| `lyric v` | 竖排模式 |
| `lyric size current|next <px>` | 字体大小 |
| `lyric lock` | 鼠标穿透 |
| `lyric offset <ms>` | LRC 时序偏移 |


#### 歌单

| 命令 | 说明 |
| - | - |
| `cd [name]` | 切换歌单 |
| `pl create <name>` | 创建歌单 |
| `pl list` | 列出歌单 |
| `pl info` | 歌单详情 |
| `pl edit <name> <field> <value>` | 编辑歌单 |
| `pl delete <name>` | 删除歌单 |
| `track info <n>` | 曲目信息 |
| `track pl <n>` | 编辑曲目所属歌单 |


#### 外观

| 命令 | 说明 |
| - | - |
| `color <type> <#hex>` | 设置颜色 |
| `colors` | 显示颜色 |
| `set bg [clear]` | 背景图 |
| `set blur <0-50>` | 模糊度 |
| `set font size|weight|import` | 字体 |
| `set maxlines <n>` | 终端最大行数 |
| `theme list|save|load|delete|export|import` | 主题管理 |
| `reset` | 恢复默认 |


#### 分享

| 命令 | 说明 |
| - | - |
| `sync pl export [name]` | 导出歌单（ZIP：音频文件 + LRC + 元数据） |
| `sync pl import` | 导入歌单 |
| `sync theme export [name]` | 导出主题 |
| `sync theme import` | 导入主题 |


#### 系统

| 命令 | 说明 |
| - | - |
| `listen` | 开启一起听，分享链接 |
| `listen ui` | 选择自定义 HTML WebUI（放在 {music_folder}/Listen_WebUI） |
| `remote start|stop|status` | HTTP API 状态 |
| `lang <en|zh|ja>` | 切换语言 |
| `help` | 帮助 |
| `clear` | 清屏 |
| `quit` | 退出 |


### Sync 分享

`sync pl export` 将歌单打包为 ZIP：

```
MusicLI_MyPlaylist_sync.zip  
  ├── README.txt         # NekoCraft / 仓库地址  
  ├── manifest.json      # 歌单元数据 + 曲目信息  
  ├── audio/             # 音频文件  
  └── lrc/               # LRC 歌词文件
```

导入时自动创建独立歌单，音频和歌词放入 `MusicLI_Imports/<playlist>/` 目录。

### Headless 模式

无需 GUI 的纯 HTTP API 服务端，可部署在 NAS / VPS / 树莓派：

```
./musicli --remote --music_folder /path/to/music  
  
# 局域网其他设备访问  
curl http://<server-ip>:PORT/status  
curl -X POST http://<server-ip>:PORT/next
```

### 配置

所有配置存储在音乐文件夹的 `config/` 子目录：

```
Music/config/  
  settings.json    # 外观、播放、歌词设置  
  themes.json      # 主题  
  playlists.json   # 歌单  
  lang.json        # 语言
```

可直接编辑 JSON 文件，重启生效。

### 技术栈

Tauri v2 · Rust 2021 · React 19 · TypeScript · Vite 8 · Symphonia · cpal · rubato · Lofty · axum · tower-http


## English

### Overview

MusicLI is a **pseudo-CLI terminal-style** desktop music player. Built with Tauri v2 + Rust + React + TypeScript. The audio engine uses Symphonia for decoding and cpal for output, with rubato sample rate conversion. Supports MP3/FLAC/WAV/OGG/M4A, ID3 metadata, LRC lyrics (inline terminal + floating desktop overlay), themes, and playlist sharing.

**v3.3 adds: 28-endpoint HTTP REST API, headless server mode.**

### Quick Start

**Prerequisites**

- [Rust toolchain](https://rustup.rs/)

- [LLVM/Clang](https://github.com/llvm/llvm-project/releases) — Required for ASIO SDK build (Windows)

- [Node.js](https://nodejs.org/) 22+

- [pnpm](https://pnpm.io/)

```
git clone https://github.com/Kirarineko/MusicLI.git  
cd MusicLI  
pnpm install  
pnpm tauri dev      # Full Tauri app (Vite + native window)  
pnpm tauri build    # Production build (GUI)  
  
# Headless binary (no GUI deps)  
cargo build --bin musicli --no-default-features --release
```

### HTTP API

The HTTP server runs automatically in the background in both GUI and Headless modes. 28 endpoints with CORS support.

```
# Check API port  
echo $MUSICLI_HTTP_PORT  
# or in GUI: remote status  
  
# cURL examples  
curl http://127.0.0.1:PORT/status  
curl -X POST http://127.0.0.1:PORT/play -H 'Content-Type: application/json' -d '{}'  
curl -X POST http://127.0.0.1:PORT/next
```

- **Playback**: `/status`, `/play`, `/pause`, `/stop`, `/next`, `/prev`, `/seek`, `/volume`

- **Audio**: `/audio-mode`, `/play-mode`, `/devices`

- **Playlists**: `/playlist`, `/playlists`, `/playlists/single`, `/playlists/switch`, `/playlists/refresh`

- **Files**: `/files`, `/metadata`, `/files/read`

- **Lyrics**: `/lyrics`, `/lyrics/parse`, `/lyrics/offsets`

- **Config**: `/config`, `/folder`, `/sync/export`, `/sync/import`

- **Stream**: `/stream`, `/stream/info`, `/listen` (listen together page)

Full API docs: [API.md](file:///home/kirarineko/codes/MusiCLI/API.md).

### Headless Mode

Deploy as a pure HTTP API server (no GUI/WebKit dependency):

```
./musicli --remote --music_folder /path/to/music  
  
# Access from other devices on LAN  
curl http://<server-ip>:PORT/status  
curl -X POST http://<server-ip>:PORT/next
```

Type `help` in GUI for all commands. Type `lang en` for English UI.

### Tech Stack

Tauri v2 · Rust 2021 · React 19 · TypeScript · Vite 8 · Symphonia · cpal · rubato · Lofty · axum · tower-http


## WebUI 自定义开发

MusiCLI 支持导入自定义 HTML 文件作为"一起听"的前端界面。用户将 HTML 文件放入音乐文件夹的 `Listen_WebUI/` 目录后，通过 `listen ui` 命令即可切换。

### 基本原则

| 原则 | 说明 |
| - | - |
| **单文件 HTML** | 所有 CSS 和 JS 尽可能内联到单个 `.html` 文件中，避免额外的 HTTP 请求 |
| **图片用相对路径** | 如需图片引用（封面占位图、背景等），使用相对路径放在 `Listen_WebUI/` 同目录，通过 `/listen/图片名` 访问 |
| **`MusiCLIPlayer` 自动内联** | `MusiCLIPlayer` 抽象层由后端自动内联到 HTML 中，自定义 WebUI 可直接 `new MusiCLIPlayer()` 使用，无需手动引入任何外部 JS 文件 |


### 文件位置

```
{music_folder}/  
  Listen_WebUI/  
    my-player.html      # 你的自定义前端  
    cover-placeholder.svg   # 可选，被 HTML 引用的资源  
    ...  
  config/               # 配置文件目录（系统管理）
```

### MusiCLIPlayer API

后端自动将 `MusiCLIPlayer` 内联到 HTML 中，直接使用即可，无需任何 `<script src>` 引用：

```
var player = new MusiCLIPlayer();
```

#### 只读属性

| 属性 | 类型 | 说明 |
| - | - | - |
| `player.track` | `object` / `null` | 当前曲目信息，详见下方 TrackInfo |
| `player.playing` | `boolean` | 是否正在播放 |
| `player.position` | `number` | 播放位置（秒） |
| `player.duration` | `number` | 当前曲目总时长（秒） |
| `player.chunk` | `number` | 当前音频 chunk 编号（每 chunk 100ms，服务端原子计数器），用作精确同步参考 |
| `player.lyrics` | `Array` | 歌词数组 `[{time, text}, ...]` |
| `player.currentLyricIndex` | `Number` | 当前歌词行索引（-1 表示无匹配行） |
| `player.connected` | `boolean` | SSE 是否已连接 |


#### TrackInfo 结构

```
{  
  path:       "/music/song.mp3",  
  title:      "歌名",  
  artist:     "艺术家",  
  album:      "专辑",  
  duration:   245.3,        // 秒  
  year:       2023,         // 可选  
  genre:      "Pop",        // 可选  
  bitrate:    320000,       // 可选  
  sample_rate: 44100,       // 可选  
  codec:      "MP3",  
  lyrics:     [{ time: 12.5, text: "第一句歌词" }, ...]  
}
```

#### 事件

| 事件 | 回调参数 | 触发时机 |
| - | - | - |
| `track` | `(track)` | 切歌时，提供完整 TrackInfo + 歌词 |
| `state` | `({playing, position, duration, chunk})` | 播放/暂停状态变化，以及 ~1s 周期同步。`chunk` 是服务端音频 chunk 编号，每 chunk=100ms，可精确计算时间戳 |
| `tick` | `(position)` | 通过 requestAnimationFrame 与显示器刷新率同步（≤50ms 间隔），提供平滑插值后的播放位置，用于更新进度条 |
| `lyric` | `(index)` | 当前歌词行索引变化时触发 |
| `connect` | `()` | SSE 首次连接成功或重连后收到数据 |
| `disconnect` | `()` | SSE 连接断开 |
| `play` | `()` | 音频自动播放成功（无需用户交互） |
| `autoplay-blocked` | `()` | 浏览器阻止了自动播放，需用户交互后调 `player.resume()` |


#### 方法

| 方法 | 说明 |
| - | - |
| `player.start()` | 启动连接（SSE + 音频流） |
| `player.resume()` | 在用户交互事件中调用，解除自动播放限制 |
| `player.setVolume(0.8)` | 设置音量 0.0 - 1.0 |
| `player.destroy()` | 清理所有连接和定时器 |
| `MusiCLIPlayer.formatTime(125.3)` | 静态方法，格式化秒数为 `"2:05"` |


#### 事件移除

`on()` 返回取消订阅函数:

```
var off = player.on('tick', function(pos) { ... });  
off();  // 取消订阅
```

### 最小示例

```
<!DOCTYPE html>  
<html lang="zh">  
<head>  
<meta charset="UTF-8">  
<meta name="viewport" content="width=device-width, initial-scale=1.0">  
<title>一起听</title>  
<style>  
  body { background: #111; color: #fff; font-family: sans-serif; text-align: center; padding: 40px; margin: 0; }  
  .title { font-size: 20px; font-weight: bold; margin-bottom: 8px; }  
  .meta  { color: #999; margin-bottom: 16px; }  
  .bar   { height: 4px; background: #333; border-radius: 2px; overflow: hidden; max-width: 300px; margin: 0 auto; }  
  .fill  { height: 100%; background: #7c3aed; width: 0%; }  
  .pos   { color: #666; font-size: 12px; margin-top: 8px; }  
  .lyrics { margin-top: 24px; min-height: 80px; }  
  .cur   { color: #7c3aed; font-weight: bold; margin-bottom: 4px; }  
  .next  { color: #666; font-size: 13px; }  
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 100; cursor: pointer; }  
  .overlay.hidden { display: none; }  
  .overlay-inner { text-align: center; padding: 32px; }  
  .overlay-inner .icon { font-size: 48px; color: #7c3aed; margin-bottom: 16px; }  
  .overlay-inner .text { font-size: 16px; margin-bottom: 8px; }  
  .overlay-inner .hint { font-size: 13px; color: #666; }  
</style>  
</head>  
<body>  
<div class="overlay" id="overlay">  
  <div class="overlay-inner">  
    <div class="icon">&#9835;</div>  
    <div class="text">点击任意位置开始播放</div>  
    <div class="hint">浏览器需要用户交互才能播放音频</div>  
  </div>  
</div>  
  <div class="title" id="title">等待播放...</div>  
  <div class="meta" id="meta"></div>  
  <div class="bar"><div class="fill" id="progress"></div></div>  
  <div class="pos" id="pos">0:00 / 0:00</div>  
  <div class="lyrics" id="lyrics"></div>

  <!--MUSICLI_JS-->
  <script>
    var overlay = document.getElementById('overlay');
    var activated = false;

    function activate() {
      if (activated) return;
      activated = true;
      overlay.classList.add('hidden');
      player.resume();
    }

    overlay.addEventListener('click', activate);

    function escapeHtml(s) {  
      var d = document.createElement('div');  
      d.textContent = s;  
      return d.innerHTML;  
    }  

    var player = new MusiCLIPlayer();  

    player.on('track', function(track) {  
      document.getElementById('title').textContent = track.title || '未知曲目';  
      document.getElementById('meta').textContent = (track.artist || '') + (track.album ? ' · ' + track.album : '');  
    });  

    player.on('tick', function(pos) {  
      var pct = player.duration > 0 ? Math.min(100, pos / player.duration * 100) : 0;  
      document.getElementById('progress').style.width = pct + '%';  
      document.getElementById('pos').textContent = MusiCLIPlayer.formatTime(pos) + ' / ' + MusiCLIPlayer.formatTime(player.duration);  
    });  

    player.on('lyric', function(idx) {  
      var el = document.getElementById('lyrics');  
      var lyrics = player.lyrics;  
      if (idx >= 0 && idx < lyrics.length) {  
        el.innerHTML = '<div class="cur">' + escapeHtml(lyrics[idx].text) + '</div>';  
      } else {  
        el.innerHTML = '<div style="color:#444">暂无歌词</div>';  
      }  
    });  

    player.on('play', function() {  
      overlay.classList.add('hidden');  
    });  

    player.on('autoplay-blocked', function() {  
      // overlay stays visible, click handler already bound above  
    });  

    player.start();  
  </script>  
</body>  
</html>
```

### 选择与部署

```
listen ui                # 列出 Listen_WebUI/ 中的 HTML 文件  
listen ui 1              # 选择第 1 个  
listen ui my-player.html # 按文件名选择  
listen ui default        # 恢复内置界面  
listen                   # 获取分享链接 http://host:port/listen
```

### SSE 数据格式（`/stream/info`）

直接连接 SSE 进行高级开发:

**`track` 事件:**

```
{  
  "path": "/music/song.mp3",  
  "title": "歌名",  
  "artist": "艺术家",  
  "album": "专辑",  
  "duration": 245.3,  
  "lyrics": [{"time": 12.5, "text": "歌词行"}]  
}
```

**`state` 事件:**

```
{"playing": true, "position": 45.3, "duration": 245.3, "chunk": 703}
```

`chunk` 是服务端音频块编号，每块 = 100ms，由原子计数器递增，可精确计算播放时间戳，无需依赖客户端时钟插值。

音频流: `GET /stream?current=true`（实时 PCM WAV，仅播放端有音频时才有声）

