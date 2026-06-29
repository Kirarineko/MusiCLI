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
```

## Notes

- The HTTP server and GUI use **independent** audio engines. Playing via HTTP API does not affect GUI playback (and vice versa).
- The `music_folder` used by HTTP endpoints is read from `ServerState`, which is currently unset by default. Config and lyrics endpoints may return `null` / empty results if `music_folder` is not configured.
- All POST/PUT endpoints use `Content-Type: application/json`.
