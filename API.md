# MusicLI HTTP API

HTTP server starts with the application on `0.0.0.0` (LAN-accessible), port starts from 52013 and increments if occupied (52013 → 52014 → …). Check port with `echo $MUSICLI_HTTP_PORT` or `remote status` command in the GUI.

## Playback

### GET /status
Return current playback state.

**Response** `200`
```json
{
  "playing": true,
  "position": 12.5,
  "duration": 331.89,
  "volume": 80,
  "mode": "normal",
  "play_mode": "normal",
  "current_index": 0,
  "playlist_len": 5,
  "current_track": "/music/song.mp3"
}
```

### GET /status/position
Get current playback position in seconds.

**Response** `200` — `12.5`

### GET /status/duration
Get current track duration in seconds.

**Response** `200` — `331.89`

### POST /play
Play a track by path, index, or resume current.

**Request**
```json
{ "path": "/music/song.mp3" }
```
or
```json
{ "index": 2 }
```
or resume current:
```json
{}
```
**Response** `200` — `StatusResponse` (same as `/status`)

### POST /pause
Pause playback.

**Response** `200`

### POST /stop
Stop playback.

**Response** `200`

### POST /next
Play next track. Wraps to first if at end.

**Response** `200` — `StatusResponse`

### POST /prev
Play previous track. Wraps to last if at start.

**Response** `200` — `StatusResponse`

### POST /seek
Seek to absolute position in seconds.

**Request**
```json
{ "seconds": 60.5 }
```
**Response** `200`

### POST /volume
Set volume (0-100).

**Request**
```json
{ "level": 50 }
```
**Response** `200` — new volume value (e.g. `50`)

### POST /mode
Set audio mode.

**Request**
```json
{ "mode": "normal" }
```
Modes: `normal` (WASAPI/ALSA shared), `asio` (exclusive, requires ASIO feature).

**Response** `200` — current mode string

### GET /audio-mode
Get current audio output mode.

**Response** `200` — `"normal"`

### POST /audio-mode
Set audio output mode (same as `POST /mode`).

**Request**
```json
{ "mode": "normal" }
```
**Response** `200` — current mode string

## Play Mode

### GET /play-mode
Get current play mode.

**Response** `200`
```json
"normal"
```
Values: `normal` (sequential), `repeat-one` (single repeat), `repeat-all` (loop all), `shuffle` (random).

### POST /play-mode
Set play mode.

**Request**
```json
{ "mode": "shuffle" }
```
**Response** `200` — mode string

## Named Playlists

Named playlists are persisted to `config/playlists.json` and require `music_folder` to be configured.

### GET /playlists
List all named playlists (summary).

**Response** `200`
```json
[
  { "name": "Default", "desc": "", "created_at": "", "track_count": 3 },
  { "name": "Favorites", "desc": "My favorites", "created_at": "2025-01-01T00:00:00Z", "track_count": 12 }
]
```

### POST /playlists
Create a new named playlist.

**Request**
```json
{ "name": "Favorites", "desc": "My favorites", "tracks": ["/music/a.mp3"] }
```
**Response** `200` — `{ "created": "Favorites" }`

### GET /playlists/single
Get a single playlist with all tracks.

**Query** `?name=Favorites`

**Response** `200`
```json
{
  "name": "Favorites",
  "desc": "My favorites",
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": null,
  "sharer": null,
  "tracks": ["/music/a.mp3", "/music/b.flac"]
}
```

### DELETE /playlists/single
Delete a named playlist.

**Query** `?name=Favorites`

**Response** `200` — `{ "deleted": "Favorites" }`

### PUT /playlists/single
Update a playlist (rename, change description, or replace tracks). Omit fields to keep them unchanged.

**Query** `?name=Favorites`

**Request**
```json
{ "name": "NewName", "desc": "Updated desc", "tracks": ["/music/b.flac"] }
```
**Response** `200` — `{ "updated": "Favorites" }`

### POST /playlists/switch
Switch to a named playlist. Loads its tracks into the audio engine's queue.

**Request**
```json
{ "name": "Favorites" }
```
**Response** `200`
```json
{ "switched": "Favorites", "track_count": 12 }
```

### POST /playlists/refresh
Reload the current playlist's tracks from `playlists.json` into the audio engine queue. Useful after externally modifying the file.

**Response** `200`
```json
{ "refreshed": true, "track_count": 72 }
```

## Playlist (flat queue)

### GET /playlist
Return current playlist tracks.

**Response** `200`
```json
["/music/a.mp3", "/music/b.mp3"]
```

### POST /playlist
Add tracks to playlist (deduplicates).

**Request**
```json
{ "paths": ["/music/a.mp3", "/music/b.mp3"] }
```
**Response** `200` — new playlist length (e.g. `2`)

## Metadata & Files

### GET /metadata
Read audio file metadata.

**Query** `?path=/music/song.mp3`

**Response** `200`
```json
{
  "title": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "year": 2023,
  "genre": "Pop",
  "track": 1,
  "duration": 331.89,
  "bitrate": 320,
  "sample_rate": 44100,
  "codec": "MP3"
}
```
Fields may be `null` if unavailable.

### GET /files
List audio files in directory (supports mp3/flac/wav/ogg/m4a/wma).

**Query** `?dir=/music/folder`

**Response** `200`
```json
["/music/folder/a.mp3", "/music/folder/b.flac"]
```

### GET /files/list
Same as `/files` — lists audio files in directory.

### GET /files/read
Read any file as base64 string.

**Query** `?path=/path/to/file.ext`

**Response** `200` — base64-encoded string

### GET /devices
List available audio output devices.

**Response** `200`
```json
["PipeWire Sound Server", "HDA NVidia, HDMI 1", ...]
```

## Stream

### GET /stream
Stream audio in two modes: **file mode** (stream/download a specific file with Range support) or **live mode** (real-time PCM broadcast of the current playback for "listen together").

**Security:** Only audio files inside the configured `music_folder` are accessible. Paths are canonicalized and checked with `starts_with`.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | — | File mode: explicit file path to stream/download |
| `current` | bool | `false` | Live mode: real-time WAV stream of the current playback. Auto-syncs position, song changes, and pause (sends silence when paused). Cannot be combined with `path` or `download`. |
| `download` | bool | `false` | File mode only: sets `Content-Disposition: attachment` to force download |

**Headers (file mode only):**

| Header | Description |
|--------|-------------|
| `Range` | Optional `bytes=start-end` for partial content (seek) |

**File mode response** `200` (full file) or `206 Partial Content` (with Range):

| Header | Value |
|--------|-------|
| `Content-Type` | `audio/mpeg`, `audio/flac`, `audio/wav`, `audio/ogg`, `audio/mp4`, `audio/x-ms-wma` |
| `Content-Length` | Number of bytes in the response |
| `Content-Range` | `bytes start-end/total` (only with Range request) |
| `Accept-Ranges` | `bytes` |
| `Content-Disposition` | `inline` or `attachment; filename="song.mp3"` |

**Live mode response** `200` (chunked transfer, no Content-Length):

| Header | Value |
|--------|-------|
| `Content-Type` | `audio/wav` |
| `Cache-Control` | `no-store` |

The live stream sends a WAV header (PCM s16) followed by continuous 100ms PCM chunks. The server monitors the shared audio engine in real-time: when the sender seeks, changes songs, or pauses, the stream automatically adjusts (silence frames during pause, seamless file switch on song change, re-seek on position divergence > 2s).

**Errors:**

| Status | Cause |
|--------|-------|
| `400` | No source parameter provided |
| `403` | Path outside `music_folder`, not an audio file, or `music_folder` not configured |
| `404` | File not found |

**cURL examples:**

```bash
# Stream a file for playback (file mode, Range support)
curl "http://127.0.0.1:52013/stream?path=/music/song.mp3" --output song.mp3

# Stream with Range (seek to 60s)
curl -H "Range: bytes=2631690-" "http://127.0.0.1:52013/stream?path=/music/song.mp3" --output song.mp3

# Download a file
curl -L "http://127.0.0.1:52013/stream?path=/music/song.mp3&download=1" -o song.mp3

# Live stream of current playback (listen together)
curl "http://127.0.0.1:52013/stream?current=true" --output live.wav
```

**HTML playback:**
```html
<!-- File mode (seekable) -->
<audio src="http://127.0.0.1:52013/stream?path=/music/song.mp3" controls></audio>

<!-- Live mode (real-time sync) -->
<audio src="http://127.0.0.1:52013/stream?current=true" controls></audio>
```

### GET /stream/info
Server-Sent Events stream of track metadata and playback state for the current playback. The `track` event includes the full LRC lyrics with timestamps — clients should compute the current lyric line locally using `audio.currentTime` for optimal sync accuracy.

**No query parameters.**

**SSE Events:**

| Event | Trigger | Data |
|-------|---------|------|
| `track` | Connection + song change | `{ path, title, artist, album, duration, year, genre, bitrate, sample_rate, codec, lyrics: [{time, text}, ...] }` |
| `state` | Play/pause change + every 1s | `{ playing, position, duration }` |
| `:keep-alive` | Every 15s (idle) | SSE comment — ignore |

**JavaScript example:**
```javascript
const es = new EventSource('http://127.0.0.1:52013/stream/info');
let lyrics = [];

es.addEventListener('track', (e) => {
  const d = JSON.parse(e.data);
  lyrics = d.lyrics || []; // Store full lyrics with timestamps
});

es.addEventListener('state', (e) => {
  const d = JSON.parse(e.data);
  // Client-side lyric tracking using audio.currentTime
  const audio = document.querySelector('audio');
  const t = audio.currentTime;
  const idx = lyrics.findLastIndex(l => l.time <= t);
  console.log('Current lyric:', idx >= 0 ? lyrics[idx].text : '');
});
```

**Security:** Same as `/stream` — only tracks within `music_folder` are reported. Metadata and LRC files are read server-side.

## Config

### GET /config
Read a config file from `{musicFolder}/config/{key}.json`.

**Query** `?key=settings`

**Response** `200` — JSON value, or `null` if file not found

### PUT /config
Write a config file.

**Query** `?key=settings`

**Request body** — any JSON value to write

**Response** `200`

### PUT /folder
Set the music folder path used by config, lyrics, and playlist endpoints.

**Request**
```json
{ "path": "/home/user/Music" }
```
**Response** `200`

The path is persisted to `~/.config/musicli/music_folder` for subsequent starts.

## Lyrics

### GET /lyrics
Search for LRC file matching an audio track.

**Query** `?audio_path=/music/song.mp3`

**Response** `200`
```json
{ "lrc_path": "/music/lrc/song.lrc" }
```
or `{ "lrc_path": null }` if not found.

### GET /lyrics/offsets
Read LRC offset overrides. `lrc_dir` is derived server-side from `{music_folder}/lrc` — no query parameters required.

**Response** `200`
```json
{ "song.lrc": 500, "other.lrc": -200 }
```

### POST /lyrics/offsets
Set LRC offset for a track (0 = clear). `lrc_dir` is derived server-side from `{music_folder}/lrc` — do not send it.

**Request**
```json
{ "track_name": "song.lrc", "offset_ms": 500 }
```
**Response** `200`

### GET /lyrics/parse
Search and parse LRC file, return time-stamped lines.

**Query** `?audio_path=/music/song.mp3` or `?lrc_path=/music/lrc/song.lrc`

**Response** `200`
```json
[
  { "time": 4.26, "text": "海浪无声将夜幕深深淹没" },
  { "time": 15.00, "text": "漫过天空尽头的角落" }
]
```

## Sync

### POST /sync/export
Export playlists to a ZIP file.

**Request**
```json
{ "dest_zip": "/tmp/export.zip", "playlist_names": ["MyPlaylist"] }
```
Omit `playlist_names` or leave empty to export all playlists.

**Response** `200`

### POST /sync/import
Import playlists from a ZIP file (reads `playlists.json` inside).

**Request**
```json
{ "zip_path": "/tmp/export.zip" }
```
**Response** `200`
```json
{ "imported": 3 }
```

## cURL Examples

```bash
# Get status
curl http://127.0.0.1:34881/status

# Add tracks and play
curl -X POST http://127.0.0.1:34881/playlist \
  -H "Content-Type: application/json" \
  -d '{"paths":["/music/song.mp3"]}'

curl -X POST http://127.0.0.1:34881/play \
  -H "Content-Type: application/json" \
  -d '{}'

# Pause / resume
curl -X POST http://127.0.0.1:34881/pause
curl -X POST http://127.0.0.1:34881/play -H "Content-Type: application/json" -d '{}'

# Seek to 60s
curl -X POST http://127.0.0.1:34881/seek \
  -H "Content-Type: application/json" \
  -d '{"seconds":60}'

# Set volume to 50%
curl -X POST http://127.0.0.1:34881/volume \
  -H "Content-Type: application/json" \
  -d '{"level":50}'

# Read metadata
curl "http://127.0.0.1:34881/metadata?path=/music/song.mp3"

# List audio files
curl "http://127.0.0.1:34881/files?dir=/music"

# Search lyrics
curl "http://127.0.0.1:34881/lyrics?audio_path=/music/song.mp3"

# Parse lyrics
curl "http://127.0.0.1:34881/lyrics/parse?audio_path=/music/song.mp3"

# Read config
curl "http://127.0.0.1:34881/config?key=settings"

# Export playlists
curl -X POST http://127.0.0.1:34881/sync/export \
  -H "Content-Type: application/json" \
  -d '{"dest_zip":"/tmp/musicli-export.zip"}'

# Stream audio for playback (supports Range/seek)
curl "http://127.0.0.1:34881/stream?path=/music/song.mp3" -o song.mp3

# Download audio file
curl -L "http://127.0.0.1:34881/stream?path=/music/song.mp3&download=1" -o song.mp3

# Stream the current playback (live sync)
curl "http://127.0.0.1:34881/stream?current=true" -o live.wav
```

## Listen Together

### GET /listen
Self-contained "listen together" web page. Open in a browser to join a synced listening session with the host.

The page connects to:
- `GET /stream?current=true` — real-time WAV audio stream
- `GET /stream/info?next=3` — SSE metadata + lyrics sync

**Behavior:**
- Dark-themed terminal-style player UI
- Auto-syncs: track info, lyrics (current + next 3 lines), playback state, progress
- Read-only — guest cannot control playback (no play/pause/seek)
- MediaSession API integration (system notification bar shows track info)
- Auto-reconnect on SSE disconnect

**Usage:** Type `listen` in the GUI terminal to get the shareable URL. Send the link to someone on the same LAN — they open it in any browser.

**Security:** The page only uses read-only endpoints. Audio file paths are validated against `music_folder`.

## Notes

- The HTTP server and GUI share a **single audio engine**. HTTP API calls directly control GUI playback and vice versa. The GUI frontend polls `/status` every 1s to reconcile state changes from external API calls (song changes, pause/play, etc.).
- The `/stream?current=true` endpoint provides a real-time PCM WAV live stream of the current playback. It auto-syncs position, song changes, and pause state — suitable for "listen together" scenarios.
- The `/stream?path=...` endpoint streams files directly with Range support for seekable browser playback.
- The `music_folder` used by HTTP endpoints is read from `ServerState`, which is currently unset by default. Config and lyrics endpoints may return `null` / empty results if `music_folder` is not configured.
- All POST/PUT endpoints use `Content-Type: application/json`.
