use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::response::sse::{Event, Sse};
use bytes::Bytes;
use symphonia::core::audio::{Audio, GenericAudioBufferRef};
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::audio::engine::SharedState;
use crate::lrc_parser::{self, LrcLine};
use crate::server_state::ServerState;

type SharedAppState = Arc<Mutex<ServerState>>;

const CHUNK_DURATION_SECS: f64 = 0.1;
const PREBUFFER_CHUNKS: usize = 25;
const INFO_POLL_INTERVAL_MS: u64 = 200;
const INFO_STATE_SYNC_INTERVAL: usize = 5;

/// Client-side playhead position (seconds) derived from the audio chunk
/// counter.  Lags behind the engine position by the prebuffer duration so the
/// progress bar stays aligned with what the listener is *actually hearing*
/// rather than with the (5 s ahead) engine state.
fn audio_position(shared: &Arc<SharedState>) -> f64 {
    let counter = shared.audio_chunk_counter.load(Ordering::Relaxed);
    let start = shared.audio_track_start_chunk.load(Ordering::Relaxed);
    let base = shared.audio_track_base_pos.load();
    let raw = base
        + (counter.saturating_sub(start) as f64) * CHUNK_DURATION_SECS
        - (PREBUFFER_CHUNKS as f64 * CHUNK_DURATION_SECS);
    if raw < 0.0 { 0.0 } else { raw }
}

/// Entry point: set up a live WAV stream of the current playback.
pub fn live_stream(state: SharedAppState) -> Result<Response, (StatusCode, String)> {
    let music_folder = {
        let s = state.lock().unwrap();
        let mf = s.music_folder.lock().unwrap().clone();
        mf
    };
    if music_folder.is_empty() {
        return Err((StatusCode::FORBIDDEN, "music_folder not configured".into()));
    }

    // Get the engine's shared atomic state for real-time monitoring.
    let shared = {
        let s = state.lock().unwrap();
        let engine = s.audio_engine.lock().unwrap();
        engine.shared_state()
    };

    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(32);

    std::thread::Builder::new()
        .name("live-stream".into())
        .spawn(move || live_producer(state, shared, music_folder, tx))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let body = Body::from_stream(ReceiverStream::new(rx));
    Response::builder()
        .header(header::CONTENT_TYPE, "audio/wav")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// Producer thread: decodes audio in real-time and sends PCM s16 chunks.
fn live_producer(
    state: SharedAppState,
    shared: Arc<SharedState>,
    music_folder: String,
    tx: mpsc::Sender<Result<Bytes, std::io::Error>>,
) {
    let mut current_path = String::new();
    // u64::MAX forces the first iteration to always fire the track-change
    // branch so that an already-playing track is picked up on (re)connect.
    let mut last_epoch: u64 = u64::MAX;
    let mut decoder: Option<LiveDecoder> = None;
    let mut header_sent = false;
    let mut stream_pos: f64 = 0.0;
    let mut wav_sample_rate: u32 = 44100;
    let mut wav_channels: u16 = 2;
    let mut chunk_idx: usize = 0;
    let mut send_buf: Vec<u8> = Vec::with_capacity(64 * 1024);
    // True once the prebuffer burst has finished and `stream_pos` has been
    // re-baselined to `engine_pos`. Until this is set the divergence-based
    // seek check (step 2) is suppressed — otherwise the burst sends 5s of
    // audio in ~0.5s of wall time while the engine only advances ~0.5s,
    // producing a >2s "divergence" that would falsely rewind the decoder
    // and cause the client to hear ~0.5s of audio twice.
    let mut burst_aligned = false;

    loop {
        if tx.is_closed() {
            break;
        }

        let chunk_start = Instant::now();

        // 1. Detect track changes via epoch (atomic read every chunk, no lock
        //    unless the epoch actually changed). Also retries when the decoder
        //    is missing (e.g. open failure on a previous attempt).
        let epoch = shared.track_epoch.load(Ordering::Acquire);
        if epoch != last_epoch || decoder.is_none() {
            last_epoch = epoch;
            let new_path = {
                let s = state.lock().unwrap();
                let engine = s.audio_engine.lock().unwrap();
                engine.get_current_path().to_string()
            };

            if new_path != current_path {
                current_path = new_path.clone();
                decoder = None;

                if !current_path.is_empty() {
                    if let Ok(canon) =
                        super::http::validate_audio_in_folder(&current_path, &music_folder)
                    {
                        if let Ok(mut d) = LiveDecoder::open(&canon) {
                            wav_sample_rate = d.sample_rate;
                            wav_channels = d.channels as u16;

                            if !header_sent {
                                let hdr = wav_header(wav_sample_rate, wav_channels);
                                if tx.blocking_send(Ok(Bytes::from(hdr.to_vec()))).is_err() {
                                    break;
                                }
                                header_sent = true;
                            }

                            let dev_sr = shared.sample_rate.load(Ordering::Relaxed).max(1);
                            let engine_pos =
                                shared.position_samples.load(Ordering::Relaxed) as f64 / dev_sr as f64;
                            d.decoder_seek(engine_pos);
                            stream_pos = engine_pos;
                            decoder = Some(d);
                            // A fresh decoder starts from a known engine-aligned
                            // position, so the post-burst realign is a no-op.
                            burst_aligned = false;
                            // Reset audio-tracking atomics: the client will
                            // hear this track (or the seeked position) after
                            // ~PREBUFFER_CHUNKS × CHUNK_DURATION_SECS seconds.
                            shared.audio_track_base_pos.store(engine_pos);
                            let cur = shared.audio_chunk_counter.load(Ordering::Relaxed);
                            shared.audio_track_start_chunk.store(cur, Ordering::Relaxed);
                        }
                    }
                }
            }
        }

        // 2. Post-burst realign *without* seeking, then divergence-based seek.
        //    During the prebuffer burst we skip this entirely (see comment on
        //    `burst_aligned`). On the first chunk after the burst we reset
        //    `stream_pos` to the live `engine_pos` without touching the decoder
        //    — the decoder intentionally leads the engine by the prebuffer
        //    duration, this only repairs the divergence baseline so that later
        //    genuine seeks (delta > 2s) are still detected.
        if chunk_idx > PREBUFFER_CHUNKS {
            if !burst_aligned {
                let dev_sr = shared.sample_rate.load(Ordering::Relaxed).max(1);
                let engine_pos =
                    shared.position_samples.load(Ordering::Relaxed) as f64 / dev_sr as f64;
                stream_pos = engine_pos;
                burst_aligned = true;
            } else if let Some(ref mut d) = decoder {
                let dev_sr = shared.sample_rate.load(Ordering::Relaxed).max(1);
                let engine_pos =
                    shared.position_samples.load(Ordering::Relaxed) as f64 / dev_sr as f64;
                if (engine_pos - stream_pos).abs() > 2.0 {
                    d.decoder_seek(engine_pos);
                    stream_pos = engine_pos;
                    // A user-initiated seek — rebase audio-tracking so the
                    // client-side playhead catches up after the prebuffer drain.
                    shared.audio_track_base_pos.store(engine_pos);
                    let cur = shared.audio_chunk_counter.load(Ordering::Relaxed);
                    shared.audio_track_start_chunk.store(cur, Ordering::Relaxed);
                }
            }
        }

        // 3. Decode and send a 100ms chunk.
        let playing = shared.playing.load(Ordering::Relaxed);
        let frame_count = (wav_sample_rate as f64 * CHUNK_DURATION_SECS) as usize;
        let sample_count = frame_count * wav_channels as usize;

        send_buf.clear();
        let chunk = if let Some(ref mut d) = decoder {
            if playing {
                let samples = d.decode_samples(sample_count);
                if samples.is_empty() {
                    silence_bytes(sample_count, &mut send_buf);
                    send_buf.as_slice()
                } else {
                    f32_to_s16_bytes(&samples, &mut send_buf);
                    send_buf.as_slice()
                }
            } else {
                silence_bytes(sample_count, &mut send_buf);
                send_buf.as_slice()
            }
        } else {
            silence_bytes(sample_count, &mut send_buf);
            send_buf.as_slice()
        };

        if tx.blocking_send(Ok(Bytes::from(chunk.to_vec()))).is_err() {
            break;
        }
        shared.audio_chunk_counter.fetch_add(1, Ordering::Relaxed);

        if playing && decoder.is_some() {
            stream_pos += CHUNK_DURATION_SECS;
        }

        // 4. Pacing: pre-buffer at start, then time-compensated sleep.
        chunk_idx += 1;
        if chunk_idx <= PREBUFFER_CHUNKS {
            // Burst: no sleep, fill client buffer as fast as possible.
            continue;
        }

        let elapsed = chunk_start.elapsed();
        let sleep_time = Duration::from_millis(100).saturating_sub(elapsed);
        if !sleep_time.is_zero() {
            std::thread::sleep(sleep_time);
        }
    }
}

// ── Live Info SSE ───────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct TrackInfo {
    path: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    genre: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bitrate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sample_rate: Option<u32>,
    codec: String,
    lyrics: Vec<LrcLine>,
}

#[derive(serde::Serialize)]
struct StateInfo {
    playing: bool,
    position: f64,
    duration: f64,
    chunk: u64,
}

/// Entry point: SSE stream of track metadata and playback state.
pub fn live_info(state: SharedAppState) -> Result<Response, (StatusCode, String)> {
    let music_folder = {
        let s = state.lock().unwrap();
        let mf = s.music_folder.lock().unwrap().clone();
        mf
    };
    if music_folder.is_empty() {
        return Err((StatusCode::FORBIDDEN, "music_folder not configured".into()));
    }

    let shared = {
        let s = state.lock().unwrap();
        let engine = s.audio_engine.lock().unwrap();
        engine.shared_state()
    };

    let (tx, rx) = mpsc::channel::<Result<Event, std::convert::Infallible>>(16);

    std::thread::Builder::new()
        .name("live-info".into())
        .spawn(move || live_info_producer(state, shared, music_folder, tx))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text(":keep-alive"),
    ).into_response())
}

/// Producer thread: sends SSE events for track changes and state.
fn live_info_producer(
    state: SharedAppState,
    shared: Arc<SharedState>,
    music_folder: String,
    tx: mpsc::Sender<Result<Event, std::convert::Infallible>>,
) {
    let mut current_path = String::new();
    // u64::MAX forces the first iteration to fire the track-change branch
    // so an already-playing track is advertised on (re)connect.
    let mut last_epoch: u64 = u64::MAX;
    let mut last_playing: bool = shared.playing.load(Ordering::Relaxed);
    let mut iteration: usize = 0;

    loop {
        if tx.is_closed() {
            break;
        }

        let iter_start = Instant::now();

        // 1. Detect track changes via epoch (atomic read every iteration, no
        //    lock unless the epoch actually changed). Detecting a change in
        //    ~200ms instead of the previous 1s means the client gets the new
        //    track's lyrics essentially at the same time as its state event,
        //    which fixes the lyric/progress-bar drift on auto-next.
        let epoch = shared.track_epoch.load(Ordering::Acquire);
        if epoch != last_epoch {
            last_epoch = epoch;
            let new_path = {
                let s = state.lock().unwrap();
                let engine = s.audio_engine.lock().unwrap();
                engine.get_current_path().to_string()
            };

            if new_path != current_path {
                current_path = new_path.clone();

                if !current_path.is_empty() {
                    let track_info = build_track_info(&current_path, &music_folder);
                    if let Some(info) = track_info {
                        let json = serde_json::to_string(&info).unwrap_or_default();
                        let event = Event::default().event("track").data(json);
                        if tx.blocking_send(Ok(event)).is_err() {
                            break;
                        }

                        // Immediately follow the track event with a state event
                        // carrying the *current* playing/position/duration so the
                        // client can resync lyrics + progress bar the moment the
                        // new track arrives. Read these atomics *after* the
                        // Acquire-load of epoch, so by the Release/Acquire
                        // contract we see the exact state play() committed before
                        // bumping the epoch.
                        let dur = shared.duration_secs.load();
                        let playing = shared.playing.load(Ordering::Relaxed);
                        let pos = audio_position(&shared);
                        let chunk = shared.audio_chunk_counter.load(Ordering::Relaxed);
                        let state_info = StateInfo {
                            playing,
                            position: pos,
                            duration: dur,
                            chunk,
                        };
                        let json = serde_json::to_string(&state_info).unwrap_or_default();
                        let event = Event::default().event("state").data(json);
                        if tx.blocking_send(Ok(event)).is_err() {
                            break;
                        }
                        // Suppress the duplicate state event that step 2 would
                        // otherwise emit for the very same playing transition.
                        last_playing = playing;
                    }
                }
            }
        }

        // 2. Check playing state change (every iteration, atomic read).
        let playing = shared.playing.load(Ordering::Relaxed);
        if playing != last_playing {
            last_playing = playing;
            let dur = shared.duration_secs.load();
            let pos = audio_position(&shared);
            let chunk = shared.audio_chunk_counter.load(Ordering::Relaxed);
            let state_info = StateInfo { playing, position: pos, duration: dur, chunk };
            let json = serde_json::to_string(&state_info).unwrap_or_default();
            let event = Event::default().event("state").data(json);
            if tx.blocking_send(Ok(event)).is_err() {
                break;
            }
        }

        // 3. Periodic state sync (every 5 iterations = 1s).
        if iteration.is_multiple_of(INFO_STATE_SYNC_INTERVAL) && iteration > 0 {
            let dur = shared.duration_secs.load();
            let pos = audio_position(&shared);
            let chunk = shared.audio_chunk_counter.load(Ordering::Relaxed);
            let state_info = StateInfo { playing, position: pos, duration: dur, chunk };
            let json = serde_json::to_string(&state_info).unwrap_or_default();
            let event = Event::default().event("state").data(json);
            if tx.blocking_send(Ok(event)).is_err() {
                break;
            }
        }

        // 4. Pacing: time-compensated sleep.
        iteration += 1;
        let elapsed = iter_start.elapsed();
        let sleep_time = Duration::from_millis(INFO_POLL_INTERVAL_MS).saturating_sub(elapsed);
        if !sleep_time.is_zero() {
            std::thread::sleep(sleep_time);
        }
    }
}

/// Build TrackInfo by reading metadata + finding/parsing LRC + applying offsets.
fn build_track_info(path: &str, music_folder: &str) -> Option<TrackInfo> {
    let meta = crate::core::metadata::read_metadata(path).ok()?;

    // Find and parse LRC
    let lrc_path = crate::core::lyrics::find_lrc(path, music_folder).ok().flatten();
    let mut lyrics = Vec::new();
    if let Some(ref lrc_file) = lrc_path {
        if let Ok(content) = std::fs::read_to_string(lrc_file) {
            lyrics = lrc_parser::parse_lrc(&content);

            // Apply per-track offset from {music_folder}/lrc/offsets.json
            let lrc_dir = std::path::Path::new(music_folder).join("lrc");
            let lrc_dir_str = lrc_dir.to_string_lossy().to_string();
            if let Ok(offsets) = crate::core::lyrics::read_lrc_offsets(&lrc_dir_str) {
                let track_name = std::path::Path::new(lrc_file)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                if let Some(&offset_ms) = offsets.get(track_name) {
                    let offset_secs = offset_ms as f64 / 1000.0;
                    for l in &mut lyrics {
                        l.time += offset_secs;
                    }
                }
            }
        }
    }

    Some(TrackInfo {
        path: path.to_string(),
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        duration: meta.duration.unwrap_or(0.0),
        year: meta.year,
        genre: meta.genre,
        bitrate: meta.bitrate,
        sample_rate: meta.sample_rate,
        codec: meta.codec,
        lyrics,
    })
}

// ── LiveDecoder ─────────────────────────────────────────────────────

struct LiveDecoder {
    reader: Box<dyn symphonia::core::formats::FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::audio::AudioDecoder>,
    track_id: u32,
    sample_rate: u32,
    channels: usize,
    buffer: Vec<f32>,
}

impl LiveDecoder {
    fn open(path: &Path) -> Result<Self, String> {
        let file = std::fs::File::open(path).map_err(|e| format!("Open: {}", e))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = path.extension() {
            hint.with_extension(&ext.to_string_lossy());
        }

        let reader = symphonia::default::get_probe()
            .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
            .map_err(|e| format!("Probe: {}", e))?;

        let track = reader
            .default_track(symphonia::core::formats::TrackType::Audio)
            .ok_or("No audio track")?
            .clone();

        let track_id = track.id;
        let audio_params = track
            .codec_params
            .as_ref()
            .and_then(|cp| cp.audio())
            .ok_or("No audio codec params")?
            .clone();

        let sample_rate = audio_params.sample_rate.unwrap_or(44100);
        let channels = audio_params
            .channels
            .as_ref()
            .map(|c| c.count())
            .unwrap_or(2);

        let decoder = symphonia::default::get_codecs()
            .make_audio_decoder(&audio_params, &Default::default())
            .map_err(|e| format!("Decoder: {}", e))?;

        Ok(Self {
            reader,
            decoder,
            track_id,
            sample_rate,
            channels,
            buffer: Vec::new(),
        })
    }

    fn decoder_seek(&mut self, seconds: f64) {
        let time = Time::try_from_secs_f64(seconds).unwrap_or_default();
        if let Err(e) = self.reader.seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time,
                track_id: Some(self.track_id),
            },
        ) {
            eprintln!("[live-stream] seek error: {}", e);
        } else {
            self.decoder.reset();
            self.buffer.clear();
        }
    }

    /// Decode packets until `count` interleaved f32 samples are available,
    /// then drain and return them. Returns fewer samples at EOF.
    fn decode_samples(&mut self, count: usize) -> Vec<f32> {
        while self.buffer.len() < count {
            let packet = match self.reader.next_packet() {
                Ok(Some(p)) => p,
                Ok(None) => break,
                Err(symphonia::core::errors::Error::IoError(ref err))
                    if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    break;
                }
                Err(e) => {
                    eprintln!("[live-stream] read error: {}", e);
                    break;
                }
            };

            if packet.track_id != self.track_id {
                continue;
            }

            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    let frames = decoded.frames();
                    let ch = self.channels;
                    let samples: Vec<f32> = match decoded {
                        GenericAudioBufferRef::F32(buf) => {
                            let mut out = vec![0.0f32; frames * ch];
                            buf.copy_to_slice_interleaved(&mut out);
                            out
                        }
                        GenericAudioBufferRef::S16(buf) => {
                            let mut raw = vec![0i16; frames * ch];
                            buf.copy_to_slice_interleaved(&mut raw);
                            raw.iter().map(|&s| s as f32 / 32768.0).collect()
                        }
                        GenericAudioBufferRef::S32(buf) => {
                            let mut raw = vec![0i32; frames * ch];
                            buf.copy_to_slice_interleaved(&mut raw);
                            raw.iter().map(|&s| s as f32 / 2147483648.0).collect()
                        }
                        GenericAudioBufferRef::U8(buf) => {
                            let mut raw = vec![0u8; frames * ch];
                            buf.copy_to_slice_interleaved(&mut raw);
                            raw.iter().map(|&s| (s as f32 - 128.0) / 128.0).collect()
                        }
                        _ => vec![0.0f32; frames * ch],
                    };
                    self.buffer.extend_from_slice(&samples);
                }
                Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
                Err(e) => {
                    eprintln!("[live-stream] decode error: {}", e);
                    break;
                }
            }
        }

        let take = count.min(self.buffer.len());
        self.buffer.drain(..take).collect()
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

/// Build a 44-byte WAV header for streaming PCM s16 with unknown length.
fn wav_header(sample_rate: u32, channels: u16) -> [u8; 44] {
    let byte_rate = sample_rate * channels as u32 * 2;
    let block_align = channels * 2;
    let mut h = [0u8; 44];

    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");

    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&channels.to_le_bytes());
    h[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    h[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    h[32..34].copy_from_slice(&block_align.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes()); // bits per sample

    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());

    h
}

/// Convert interleaved f32 samples to little-endian s16 bytes into `out`.
fn f32_to_s16_bytes(samples: &[f32], out: &mut Vec<u8>) {
    out.clear();
    out.reserve(samples.len() * 2);
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let val = (clamped * 32767.0) as i16;
        out.extend_from_slice(&val.to_le_bytes());
    }
}

/// Write `sample_count` samples worth of silence (zero bytes) into `out`.
fn silence_bytes(sample_count: usize, out: &mut Vec<u8>) {
    out.clear();
    out.resize(sample_count * 2, 0);
}
