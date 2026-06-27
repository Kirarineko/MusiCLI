# MusicLI HTTP API

HTTP server starts with the application on `127.0.0.1`, port assigned randomly. Check port with `echo $MUSICLI_HTTP_PORT` or `server status` command in the GUI.

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
  "current_index": 0,
  "playlist_len": 5,
  "current_track": "/music/song.mp3"
}
```

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

**Response** `204`

### POST /stop
Stop playback.

**Response** `204`

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
**Response** `204`

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
Get current audio mode.

**Response** `200` — `"normal"`

## Playlist

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

## Config

### GET /config
Read a config file from `{musicFolder}/config/{key}.json`.

**Query** `?key=settings`

**Response** `200` — JSON value, or `null` if file not found

### PUT /config
Write a config file.

**Query** `?key=settings`

**Request body** — any JSON value to write

**Response** `204`

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
Read LRC offset overrides.

**Query** `?lrc_dir=/music/lrc/`

**Response** `200`
```json
{ "song.lrc": 500, "other.lrc": -200 }
```

### POST /lyrics/offsets
Set LRC offset for a track (0 = clear).

**Request**
```json
{ "lrc_dir": "/music/lrc/", "track_name": "song.lrc", "offset_ms": 500 }
```
**Response** `204`

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

**Response** `204`

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
```

## Notes

- The HTTP server and GUI use **independent** audio engines. Playing via HTTP API does not affect GUI playback (and vice versa).
- The `music_folder` used by HTTP endpoints is read from `ServerState`, which is currently unset by default. Config and lyrics endpoints may return `null` / empty results if `music_folder` is not configured.
- All POST/PUT endpoints use `Content-Type: application/json`.
