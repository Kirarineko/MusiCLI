// Offline audio transcoding for LLM tagging attachments (GUI only).
// Decodes any Symphonia-supported file, downmixes to mono, and encodes a
// small 64 kbps MP3 with bundled LAME — so large or non-mp3/wav files can
// still be attached to `input_audio` without hitting provider size limits.

use std::fs::File;

use symphonia::core::audio::{Audio, GenericAudioBufferRef};
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

/// Decode `path` and re-encode as mono 64 kbps MP3, keeping at most
/// `max_seconds` of audio. At 64 kbps this bounds the output to
/// ~8 KB/s × max_seconds (600 s ≈ 4.7 MiB).
pub fn compress_to_mp3(path: &str, max_seconds: f64) -> Result<Vec<u8>, String> {
    let (mono, sample_rate) = decode_mono(path, max_seconds)?;
    if mono.is_empty() {
        return Err("No audio samples decoded".into());
    }
    encode_mp3_mono(&mono, sample_rate)
}

/// Decode up to `max_seconds` of audio as mono f32 samples.
fn decode_mono(path: &str, max_seconds: f64) -> Result<(Vec<f32>, u32), String> {
    let file = File::open(path).map_err(|e| format!("Cannot open file: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension() {
        hint.with_extension(&ext.to_string_lossy());
    }

    let mut reader = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|e| format!("Probe error: {}", e))?;

    let track = reader
        .default_track(TrackType::Audio)
        .ok_or("No audio track found")?
        .clone();
    let track_id = track.id;

    let audio_params = track
        .codec_params
        .as_ref()
        .and_then(|cp| cp.audio())
        .ok_or("No audio codec params")?
        .clone();

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&audio_params, &Default::default())
        .map_err(|e| format!("Codec error: {}", e))?;

    let sample_rate = audio_params.sample_rate.unwrap_or(44100);
    let channels = audio_params
        .channels
        .as_ref()
        .map(|c| c.count())
        .unwrap_or(2)
        .max(1);

    let max_frames = (max_seconds * sample_rate as f64) as usize;
    let mut mono: Vec<f32> = Vec::new();

    loop {
        if mono.len() >= max_frames {
            break;
        }
        let packet = match reader.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(e) => return Err(format!("Read error: {}", e)),
        };
        if packet.track_id != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            // Skip corrupt packets, same as the playback decoder.
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(e) => return Err(format!("Decode error: {}", e)),
        };
        let frames = decoded.frames();
        let interleaved: Vec<f32> = match decoded {
            GenericAudioBufferRef::F32(buf) => {
                let mut out = vec![0.0f32; frames * channels];
                buf.copy_to_slice_interleaved(&mut out);
                out
            }
            GenericAudioBufferRef::S16(buf) => {
                let mut raw = vec![0i16; frames * channels];
                buf.copy_to_slice_interleaved(&mut raw);
                raw.iter().map(|&s| s as f32 / 32768.0).collect()
            }
            GenericAudioBufferRef::S32(buf) => {
                let mut raw = vec![0i32; frames * channels];
                buf.copy_to_slice_interleaved(&mut raw);
                raw.iter().map(|&s| s as f32 / 2147483648.0).collect()
            }
            GenericAudioBufferRef::U8(buf) => {
                let mut raw = vec![0u8; frames * channels];
                buf.copy_to_slice_interleaved(&mut raw);
                raw.iter().map(|&s| (s as f32 - 128.0) / 128.0).collect()
            }
            _ => continue,
        };
        for frame in interleaved.chunks_exact(channels) {
            mono.push(frame.iter().sum::<f32>() / channels as f32);
        }
    }

    mono.truncate(max_frames);
    Ok((mono, sample_rate))
}

/// Encode mono f32 samples as a 64 kbps MP3 (LAME resamples internally to a
/// supported output rate when needed).
fn encode_mp3_mono(mono: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    use mp3lame_encoder::{Bitrate, Builder, FlushNoGap, MonoPcm, Quality};

    let pcm: Vec<i16> = mono
        .iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect();

    let mut builder = Builder::new().ok_or("Failed to create LAME encoder")?;
    builder
        .set_num_channels(1)
        .map_err(|e| format!("LAME channels: {}", e))?;
    builder
        .set_sample_rate(sample_rate)
        .map_err(|e| format!("LAME sample rate: {}", e))?;
    builder
        .set_brate(Bitrate::Kbps64)
        .map_err(|e| format!("LAME bitrate: {}", e))?;
    builder
        .set_quality(Quality::Good)
        .map_err(|e| format!("LAME quality: {}", e))?;
    let mut encoder = builder.build().map_err(|e| format!("LAME build: {}", e))?;

    let mut out: Vec<u8> = Vec::with_capacity(mp3lame_encoder::max_required_buffer_size(pcm.len()));
    let n = encoder
        .encode(MonoPcm(&pcm), out.spare_capacity_mut())
        .map_err(|e| format!("LAME encode: {}", e))?;
    // SAFETY: encode() initialized exactly `n` bytes of the spare capacity.
    unsafe { out.set_len(out.len() + n) };
    let n = encoder
        .flush::<FlushNoGap>(out.spare_capacity_mut())
        .map_err(|e| format!("LAME flush: {}", e))?;
    // SAFETY: flush() initialized exactly `n` bytes of the spare capacity.
    unsafe { out.set_len(out.len() + n) };
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Minimal 16-bit PCM WAV: mono sine wave.
    fn write_test_wav(path: &std::path::Path, sample_rate: u32, seconds: f64) {
        let n = (sample_rate as f64 * seconds) as usize;
        let mut data = Vec::with_capacity(n * 2);
        for i in 0..n {
            let s = (2.0 * std::f64::consts::PI * 440.0 * i as f64 / sample_rate as f64).sin();
            data.extend_from_slice(&((s * 20000.0) as i16).to_le_bytes());
        }
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(b"RIFF").unwrap();
        f.write_all(&(36 + data.len() as u32).to_le_bytes()).unwrap();
        f.write_all(b"WAVEfmt ").unwrap();
        f.write_all(&16u32.to_le_bytes()).unwrap();
        f.write_all(&1u16.to_le_bytes()).unwrap(); // PCM
        f.write_all(&1u16.to_le_bytes()).unwrap(); // mono
        f.write_all(&sample_rate.to_le_bytes()).unwrap();
        f.write_all(&(sample_rate * 2).to_le_bytes()).unwrap();
        f.write_all(&2u16.to_le_bytes()).unwrap();
        f.write_all(&16u16.to_le_bytes()).unwrap();
        f.write_all(b"data").unwrap();
        f.write_all(&(data.len() as u32).to_le_bytes()).unwrap();
        f.write_all(&data).unwrap();
    }

    #[test]
    fn test_compress_wav_to_mp3() {
        let dir = tempfile::TempDir::new().unwrap();
        let wav = dir.path().join("tone.wav");
        write_test_wav(&wav, 44100, 1.0);
        let mp3 = compress_to_mp3(wav.to_str().unwrap(), 600.0).unwrap();
        assert!(!mp3.is_empty());
        // 64 kbps × 1 s ≈ 8 KB — far below the 88 KB source WAV.
        assert!(mp3.len() < 20_000, "mp3 too large: {}", mp3.len());
    }

    #[test]
    fn test_compress_respects_duration_cap() {
        let dir = tempfile::TempDir::new().unwrap();
        let wav = dir.path().join("tone.wav");
        write_test_wav(&wav, 44100, 2.0);
        let full = compress_to_mp3(wav.to_str().unwrap(), 600.0).unwrap();
        let capped = compress_to_mp3(wav.to_str().unwrap(), 0.5).unwrap();
        assert!(capped.len() < full.len());
    }
}
