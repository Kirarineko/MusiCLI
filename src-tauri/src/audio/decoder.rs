use std::fs::File;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use rb::RbProducer;
use symphonia::core::audio::{Audio, GenericAudioBufferRef};
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::Time;

use super::engine::SharedState;
use super::resampler::AudioResampler;

pub(crate) fn probe_duration(path: &str) -> Result<f64, String> {
    let (duration, _, _) = probe_info(path)?;
    Ok(duration)
}

pub(crate) fn probe_info(path: &str) -> Result<(f64, u32, u32), String> {
    let file = File::open(path).map_err(|e| format!("Cannot open file: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension() {
        hint.with_extension(&ext.to_string_lossy());
    }

    let reader = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|e| format!("Probe error: {}", e))?;

    let track = reader
        .default_track(symphonia::core::formats::TrackType::Audio)
        .ok_or("No audio track found")?;

    let (sample_rate, channels) = if let Some(ref cp) = track.codec_params {
        let audio = cp.audio();
        let sr = audio.and_then(|a| a.sample_rate).unwrap_or(44100);
        let ch = audio
            .and_then(|a| a.channels.as_ref().map(|c| c.count() as u32))
            .unwrap_or(2);
        (sr, ch)
    } else {
        (44100u32, 2u32)
    };

    let duration = track
        .num_frames
        .map(|f| f as f64 / sample_rate as f64)
        .unwrap_or(0.0);

    Ok((duration, sample_rate, channels))
}

pub(crate) fn decode_loop(
    path: &str,
    state: Arc<SharedState>,
    ring_prod: rb::Producer<f32>,
    mut resampler: Option<AudioResampler>,
) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        decode_inner(path, state, ring_prod, &mut resampler);
    }));

    if let Err(e) = result {
        eprintln!("[audio-decoder] panicked: {:?}", e);
    }
}

/// After resampling, write samples to the ring buffer (blocking).
/// Returns false if stopped or if the consumer appears dead (timeout).
fn write_to_ring(ring_prod: &rb::Producer<f32>, samples: &[f32], stop_flag: &Arc<SharedState>) -> bool {
    let mut written = 0;
    let mut consecutive_failures: u32 = 0;
    // After ~2 seconds of failed writes (400 × 5ms), assume the output
    // stream is dead and bail out to prevent a deadlock in stop_internal().
    const MAX_FAILURES: u32 = 400;
    while written < samples.len() {
        if stop_flag.stop_flag.load(Ordering::Relaxed) {
            return false;
        }
        match ring_prod.write(&samples[written..]) {
            Ok(n) => {
                written += n;
                consecutive_failures = 0;
            }
            Err(_) => {
                consecutive_failures += 1;
                if consecutive_failures >= MAX_FAILURES {
                    eprintln!("[audio-decoder] ring buffer write timeout — output stream likely dead");
                    return false;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        }
    }
    true
}

fn decode_inner(
    path: &str,
    state: Arc<SharedState>,
    ring_prod: rb::Producer<f32>,
    resampler: &mut Option<AudioResampler>,
) {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[audio-decoder] cannot open: {}", e);
            return;
        }
    };

    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension() {
        hint.with_extension(&ext.to_string_lossy());
    }

    let mut reader = match symphonia::default::get_probe().probe(
        &hint,
        mss,
        FormatOptions::default(),
        MetadataOptions::default(),
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[audio-decoder] probe error: {}", e);
            return;
        }
    };

    let track = match reader.default_track(symphonia::core::formats::TrackType::Audio) {
        Some(t) => t.clone(),
        None => {
            eprintln!("[audio-decoder] no audio track");
            return;
        }
    };

    let track_id = track.id;

    let audio_params = match track.codec_params.as_ref().and_then(|cp| cp.audio()) {
        Some(a) => a.clone(),
        None => {
            eprintln!("[audio-decoder] no audio codec params");
            return;
        }
    };

    let mut decoder = match symphonia::default::get_codecs()
        .make_audio_decoder(&audio_params, &Default::default())
    {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[audio-decoder] codec error: {}", e);
            return;
        }
    };

    let channels = audio_params
        .channels
        .as_ref()
        .map(|c| c.count())
        .unwrap_or(2);

    let channels_usize = channels.max(1) as usize;
    let mut eof = false;

    loop {
        if state.stop_flag.load(Ordering::Relaxed) {
            break;
        }

        let seek_req = state.seek_request.swap(-1, Ordering::Relaxed);
        if seek_req >= 0 {
            // seek_req is in device-rate samples. Re-read device_sr in case it
            // changed since the function was entered.
            let dev_sr = state.sample_rate.load(Ordering::Relaxed).max(1);
            let seek_seconds = seek_req as f64 / dev_sr as f64;
            let time = Time::try_from_secs_f64(seek_seconds).unwrap_or_default();
            if let Err(e) = reader.seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time,
                    track_id: Some(track_id),
                },
            ) {
                eprintln!("[audio-decoder] seek error: {}", e);
            } else {
                decoder.reset();
                // Reset resampler internal buffer — keep the instance alive.
                if let Some(ref mut r) = resampler {
                    r.reset();
                }
                state
                    .position_samples
                    .store(seek_req.max(0) as u64, Ordering::Relaxed);
                // Clear EOF so the loop resumes reading packets after a
                // backward seek past the end of the track.
                eof = false;
            }
        }

        if eof {
            // Wait for the ring buffer to drain before signaling track end.
            // The output callback advances position_samples as it consumes
            // data; once position reaches duration the audible playback is
            // truly finished.  This prevents the frontend from seeing
            // playing=false while there is still audio in the buffer.
            let dur = state.duration_secs.load();
            let sr = state.sample_rate.load(Ordering::Relaxed).max(1) as u64;
            let dur_samples = (dur * sr as f64) as u64;
            let mut drain_wait_ms: u64 = 0;
            // Max drain wait: ring buffer is ~93ms; allow generous margin.
            // Also bail if position stops advancing (dead output stream).
            let mut last_pos = state.position_samples.load(Ordering::Relaxed);
            let mut stall_ms: u64 = 0;
            loop {
                if state.stop_flag.load(Ordering::Relaxed) {
                    return;
                }
                let pos = state.position_samples.load(Ordering::Relaxed);
                if dur_samples == 0 || pos >= dur_samples {
                    break;
                }
                // Detect stalled output (position not advancing).
                if pos == last_pos {
                    stall_ms += 10;
                    if stall_ms >= 500 {
                        break; // output stream dead — give up
                    }
                } else {
                    stall_ms = 0;
                    last_pos = pos;
                }
                drain_wait_ms += 10;
                if drain_wait_ms >= 2000 {
                    break; // safety cap
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            state.playing.store(false, Ordering::Relaxed);
            // Park until stopped or a seek arrives (e.g. repeat-one replays
            // the same file via playIndex → load_track → seek_request).
            loop {
                if state.stop_flag.load(Ordering::Relaxed) {
                    return;
                }
                if state.seek_request.load(Ordering::Relaxed) >= 0 {
                    // A seek was requested — re-enter the decode loop so the
                    // seek handler at the top can process it.
                    eof = false;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            continue;
        }

        let packet = match reader.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => {
                eof = true;
                continue;
            }
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                eof = true;
                continue;
            }
            Err(e) => {
                eprintln!("[audio-decoder] read error: {}", e);
                break;
            }
        };

        if packet.track_id != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                let frames = decoded.frames();
                let samples: Vec<f32> = match decoded {
                    GenericAudioBufferRef::F32(buf) => {
                        let mut out = vec![0.0f32; frames * channels_usize];
                        buf.copy_to_slice_interleaved(&mut out);
                        out
                    }
                    GenericAudioBufferRef::S16(buf) => {
                        let mut raw = vec![0i16; frames * channels_usize];
                        buf.copy_to_slice_interleaved(&mut raw);
                        raw.iter().map(|&s| s as f32 / 32768.0).collect()
                    }
                    GenericAudioBufferRef::S32(buf) => {
                        let mut raw = vec![0i32; frames * channels_usize];
                        buf.copy_to_slice_interleaved(&mut raw);
                        raw.iter().map(|&s| s as f32 / 2147483648.0).collect()
                    }
                    GenericAudioBufferRef::U8(buf) => {
                        let mut raw = vec![0u8; frames * channels_usize];
                        buf.copy_to_slice_interleaved(&mut raw);
                        raw.iter().map(|&s| (s as f32 - 128.0) / 128.0).collect()
                    }
                    _ => {
                        vec![0.0f32; frames * channels_usize]
                    }
                };

                if let Some(ref mut r) = resampler {
                    // Resample from source rate to device rate.
                    match r.process(&samples) {
                        Ok(resampled) => {
                            if !write_to_ring(&ring_prod, &resampled, &state) {
                                return;
                            }
                        }
                        Err(e) => {
                            eprintln!("[audio-decoder] resample error: {}", e);
                            // Write original samples as fallback (may sound wrong
                            // but keeps playback going).
                            if !write_to_ring(&ring_prod, &samples, &state) {
                                return;
                            }
                        }
                    }
                } else {
                    // No resampling needed — write decoded samples directly.
                    if !write_to_ring(&ring_prod, &samples, &state) {
                        return;
                    }
                }
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => {
                continue;
            }
            Err(e) => {
                eprintln!("[audio-decoder] decode error: {}", e);
                break;
            }
        }
    }
}
