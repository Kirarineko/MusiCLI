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
    let channels = config.channels as usize;

    let stream = device
        .build_output_stream(
            config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let vol = state.volume.load(Ordering::Relaxed) as f32 / 100.0;
                let read = ring_cons.read(data).unwrap_or(0);

                for sample in data[..read].iter_mut() {
                    *sample *= vol;
                }
                for sample in data[read..].iter_mut() {
                    *sample = 0.0;
                }

                let frames = read / channels;
                state
                    .position_samples
                    .fetch_add(frames as u64, Ordering::Relaxed);
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
