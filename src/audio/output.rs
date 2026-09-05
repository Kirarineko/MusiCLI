use std::sync::atomic::Ordering;
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rb::RbConsumer;

use super::engine::SharedState;
use super::AudioMode;

pub(crate) fn create_stream(
    mode: AudioMode,
    ring_cons: rb::Consumer<f32>,
    state: Arc<SharedState>,
) -> Result<Box<dyn StreamTrait + Send>, String> {
    match mode {
        AudioMode::Wasapi => create_default_stream(ring_cons, state),
        AudioMode::Asio => create_asio_stream(ring_cons, state),
    }
}

/// Query the output device's default sample rate.
/// Used to know what rate the ring buffer / resampler should target.
pub(crate) fn device_sample_rate() -> Result<u32, String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("No audio output device found")?;
    let cfg = device
        .default_output_config()
        .map_err(|e| format!("Audio config error: {}", e))?;
    Ok(cfg.sample_rate())
}

fn create_default_stream(
    ring_cons: rb::Consumer<f32>,
    state: Arc<SharedState>,
) -> Result<Box<dyn StreamTrait + Send>, String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("No audio output device found")?;

    let default_config = device
        .default_output_config()
        .map_err(|e| format!("Audio config error: {}", e))?;

    let config = default_config.config();
    let device_channels = config.channels as usize;
    if device_channels == 0 {
        return Err("Device reports 0 output channels".into());
    }

    let stream = device
        .build_output_stream(
            config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let vol = state.volume.load(Ordering::Relaxed) as f32 / 100.0;
                let src_channels = state.channels.load(Ordering::Relaxed) as usize;
                let src_channels = if src_channels == 0 { 2 } else { src_channels };

                if src_channels == device_channels {
                    // Matching layout — read directly, apply volume.
                    let read = ring_cons.read(data).unwrap_or(0);
                    for sample in data[..read].iter_mut() {
                        *sample *= vol;
                    }
                    for sample in data[read..].iter_mut() {
                        *sample = 0.0;
                    }
                    let frames = read / device_channels;
                    state
                        .position_samples
                        .fetch_add(frames as u64, Ordering::Relaxed);
                } else {
                    // Mismatched layout — read source frames then up/down-mix.
                    let device_frames = data.len() / device_channels;
                    let needed = device_frames * src_channels;
                    let mut src_buf = vec![0.0f32; needed];
                    let read = ring_cons.read(&mut src_buf).unwrap_or(0);
                    let src_frames_read = read / src_channels;

                    // Fill device buffer frame-by-frame.
                    for f in 0..device_frames {
                        let src_off = f * src_channels;
                        let dst_off = f * device_channels;
                        if f < src_frames_read {
                            if src_channels == 1 && device_channels >= 2 {
                                // Mono → stereo (or more): duplicate to all channels.
                                let s = src_buf[src_off] * vol;
                                for c in 0..device_channels {
                                    data[dst_off + c] = s;
                                }
                            } else if device_channels == 1 && src_channels >= 2 {
                                // Multi → mono: average all source channels.
                                let mut sum = 0.0f32;
                                for c in 0..src_channels {
                                    sum += src_buf[src_off + c];
                                }
                                data[dst_off] = (sum / src_channels as f32) * vol;
                            } else {
                                // General: copy min channels, zero the rest.
                                let common = src_channels.min(device_channels);
                                for c in 0..common {
                                    data[dst_off + c] = src_buf[src_off + c] * vol;
                                }
                                for c in common..device_channels {
                                    data[dst_off + c] = 0.0;
                                }
                            }
                        } else {
                            for c in 0..device_channels {
                                data[dst_off + c] = 0.0;
                            }
                        }
                    }
                    // Position advances by the number of *source* frames consumed
                    // (converted to device-rate samples below by the caller as needed;
                    // here we track source frames × src_channels = source samples).
                    state
                        .position_samples
                        .fetch_add(src_frames_read as u64, Ordering::Relaxed);
                }
            },
            |err| eprintln!("[audio-default] error: {}", err),
            None,
        )
        .map_err(|e| format!("Stream build error: {}", e))?;

    Ok(Box::new(stream))
}

#[allow(unused_variables)]
fn create_asio_stream(
    _ring_cons: rb::Consumer<f32>,
    _state: Arc<SharedState>,
) -> Result<Box<dyn StreamTrait + Send>, String> {
    #[cfg(feature = "asio")]
    {
        let host = cpal::host_from_id(cpal::HostId::Asio).map_err(|_| {
            "ASIO host not available. Install ASIO drivers (ASIO4ALL, FlexASIO, etc.)".to_string()
        })?;

        let device = host
            .default_output_device()
            .ok_or("No ASIO output device found")?;

        let default_config = device
            .default_output_config()
            .map_err(|e| format!("ASIO config error: {}", e))?;

        let config = default_config.config();
        let channels = config.channels as usize;

        let stream = device
            .build_output_stream(
                config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    let vol = _state.volume.load(Ordering::Relaxed) as f32 / 100.0;
                    let read = _ring_cons.read(data).unwrap_or(0);

                    for sample in data[..read].iter_mut() {
                        *sample *= vol;
                    }
                    for sample in data[read..].iter_mut() {
                        *sample = 0.0;
                    }

                    let frames = read / channels;
                    _state
                        .position_samples
                        .fetch_add(frames as u64, Ordering::Relaxed);
                },
                |err| eprintln!("[audio-asio] error: {}", err),
                None,
            )
            .map_err(|e| format!("ASIO stream build error: {}", e))?;

        Ok(Box::new(stream))
    }

    #[cfg(not(feature = "asio"))]
    {
        Err("ASIO support not compiled. Rebuild with `asio` feature enabled.".to_string())
    }
}
