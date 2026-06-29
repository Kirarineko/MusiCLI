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
const PREBUFFER_CHUNKS: usize = 20;
const SEEK_CHECK_INTERVAL: usize = 5;
const INFO_POLL_INTERVAL_MS: u64 = 200;
const INFO_PATH_CHECK_INTERVAL: usize = 5;
const INFO_STATE_SYNC_INTERVAL: usize = 5;
pub const DEFAULT_NEXT_LYRIC_COUNT: usize = 3;

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
    let mut decoder: Option<LiveDecoder> = None;
    let mut header_sent = false;
    let mut stream_pos: f64 = 0.0;
    let mut wav_sample_rate: u32 = 44100;
    let mut wav_channels: u16 = 2;
    let mut chunk_idx: usize = 0;
    let mut send_buf: Vec<u8> = Vec::with_capacity(64 * 1024);

    loop {
        if tx.is_closed() {
            break;
        }

        let chunk_start = Instant::now();

        // 1. Check current_path for song changes (every 5 chunks to reduce lock contention).
        if chunk_idx.is_multiple_of(SEEK_CHECK_INTERVAL) || decoder.is_none() {
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
                        }
                    }
                }
            }
        }

        // 2. Check for seek (position divergence > 2s) — atomic reads, no lock needed.
        if let Some(ref mut d) = decoder {
            let dev_sr = shared.sample_rate.load(Ordering::Relaxed).max(1);
            let engine_pos =
                shared.position_samples.load(Ordering::Relaxed) as f64 / dev_sr as f64;
            if (engine_pos - stream_pos).abs() > 2.0 {
                d.decoder_seek(engine_pos);
                stream_pos = engine_pos;
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
struct LyricInfo {
    index: i32,
    current: String,
    next: Vec<String>,
}

#[derive(serde::Serialize)]
struct StateInfo {
    playing: bool,
    position: f64,
    duration: f64,
}

/// Entry point: SSE stream of track metadata, lyrics, and playback state.
pub fn live_info(state: SharedAppState, next_count: usize) -> Result<Response, (StatusCode, String)> {
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

    let next = next_count.max(1);
    let (tx, rx) = mpsc::channel::<Result<Event, std::convert::Infallible>>(16);

    std::thread::Builder::new()
        .name("live-info".into())
        .spawn(move || live_info_producer(state, shared, music_folder, tx, next))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx);
    Ok(Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text(":keep-alive"),
    ).into_response())
}

/// Producer thread: sends SSE events for track changes, lyric lines, and state.
fn live_info_producer(
    state: SharedAppState,
    shared: Arc<SharedState>,
    music_folder: String,
    tx: mpsc::Sender<Result<Event, std::convert::Infallible>>,
    next_count: usize,
) {
    let mut current_path = String::new();
    let mut lyrics: Vec<LrcLine> = Vec::new();
    let mut last_lyric_idx: i32 = -1;
    let mut last_playing: bool = false;
    let mut iteration: usize = 0;

    loop {
        if tx.is_closed() {
            break;
        }

        let iter_start = Instant::now();

        // 1. Check current_path for song changes (every 5 iterations = 1s).
        if iteration.is_multiple_of(INFO_PATH_CHECK_INTERVAL) || (current_path.is_empty() && iteration == 0) {
            let new_path = {
                let s = state.lock().unwrap();
                let engine = s.audio_engine.lock().unwrap();
                engine.get_current_path().to_string()
            };

            if new_path != current_path {
                current_path = new_path.clone();
                lyrics.clear();
                last_lyric_idx = -1;

                if !current_path.is_empty() {
                    let track_info = build_track_info(&current_path, &music_folder);
                    if let Some(info) = track_info {
                        lyrics = info.lyrics.clone();
                        let json = serde_json::to_string(&info).unwrap_or_default();
                        let event = Event::default().event("track").data(json);
                        if tx.blocking_send(Ok(event)).is_err() {
                            break;
                        }
                    }
                }
            }
        }

        // 2. Check playing state change (every iteration, atomic read).
        let playing = shared.playing.load(Ordering::Relaxed);
        if playing != last_playing {
            last_playing = playing;
            let dev_sr = shared.sample_rate.load(Ordering::Relaxed).max(1);
            let pos = shared.position_samples.load(Ordering::Relaxed) as f64 / dev_sr as f64;
            let dur = shared.duration_secs.load();
            let state_info = StateInfo { playing, position: pos, duration: dur };
            let json = serde_json::to_string(&state_info).unwrap_or_default();
            let event = Event::default().event("state").data(json);
            if tx.blocking_send(Ok(event)).is_err() {
                break;
            }
        }

        // 3. Check current lyric line (every iteration, only on change).
        if !lyrics.is_empty() {
            let dev_sr = shared.sample_rate.load(Ordering::Relaxed).max(1);
            let pos = shared.position_samples.load(Ordering::Relaxed) as f64 / dev_sr as f64;
            let idx = lrc_parser::get_current_line_idx(&lyrics, pos);
            if idx != last_lyric_idx {
                last_lyric_idx = idx;
                let current = if idx >= 0 { lyrics[idx as usize].text.as_str() } else { "" };
                let next: Vec<String> = (1..=next_count)
                    .filter_map(|i| {
                        let li = (idx + i as i32) as usize;
                        if li < lyrics.len() { Some(lyrics[li].text.clone()) } else { None }
                    })
                    .collect();
                let info = LyricInfo { index: idx, current: current.to_string(), next };
                let json = serde_json::to_string(&info).unwrap_or_default();
                let event = Event::default().event("lyric").data(json);
                if tx.blocking_send(Ok(event)).is_err() {
                    break;
                }
            }
        }

        // 4. Periodic state sync (every 5 iterations = 1s).
        if iteration.is_multiple_of(INFO_STATE_SYNC_INTERVAL) && iteration > 0 {
            let dev_sr = shared.sample_rate.load(Ordering::Relaxed).max(1);
            let pos = shared.position_samples.load(Ordering::Relaxed) as f64 / dev_sr as f64;
            let dur = shared.duration_secs.load();
            let state_info = StateInfo { playing, position: pos, duration: dur };
            let json = serde_json::to_string(&state_info).unwrap_or_default();
            let event = Event::default().event("state").data(json);
            if tx.blocking_send(Ok(event)).is_err() {
                break;
            }
        }

        // 5. Pacing: time-compensated sleep.
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
