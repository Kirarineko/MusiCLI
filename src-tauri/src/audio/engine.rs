use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;

use rb::{SpscRb, RB};

use super::decoder;
use super::output;
use super::resampler::AudioResampler;
use super::AudioMode;

const RING_BUFFER_FRAMES: usize = 4096;

pub(crate) struct AtomicF64 {
    bits: AtomicU64,
}

impl AtomicF64 {
    fn new(v: f64) -> Self {
        Self {
            bits: AtomicU64::new(v.to_bits()),
        }
    }
    fn store(&self, v: f64) {
        self.bits.store(v.to_bits(), Ordering::Relaxed);
    }
    fn load(&self) -> f64 {
        f64::from_bits(self.bits.load(Ordering::Relaxed))
    }
}

unsafe impl Send for AtomicF64 {}
unsafe impl Sync for AtomicF64 {}

pub(crate) struct SharedState {
    pub position_samples: AtomicU64,
    pub duration_secs: AtomicF64,
    pub volume: AtomicU32,
    pub playing: AtomicBool,
    pub stop_flag: AtomicBool,
    pub seek_request: AtomicI64,
    pub sample_rate: AtomicU32,
    pub channels: AtomicU32,
}

impl SharedState {
    fn new() -> Self {
        Self {
            position_samples: AtomicU64::new(0),
            duration_secs: AtomicF64::new(0.0),
            volume: AtomicU32::new(80),
            playing: AtomicBool::new(false),
            stop_flag: AtomicBool::new(false),
            seek_request: AtomicI64::new(-1),
            sample_rate: AtomicU32::new(44100),
            channels: AtomicU32::new(2),
        }
    }
}

pub struct AudioEngine {
    mode: AudioMode,
    state: Arc<SharedState>,
    decoder_handle: Option<thread::JoinHandle<()>>,
    stream: Option<Box<dyn cpal::traits::StreamTrait + Send>>,
    current_path: String,
}

impl AudioEngine {
    pub fn new() -> Self {
        Self {
            mode: AudioMode::Wasapi,
            state: Arc::new(SharedState::new()),
            decoder_handle: None,
            stream: None,
            current_path: String::new(),
        }
    }

    pub fn load_track(&mut self, path: &str) -> Result<f64, String> {
        self.stop_internal();

        let duration = decoder::probe_duration(path)?;
        self.state.duration_secs.store(duration);
        self.state
            .position_samples
            .store(0, Ordering::Relaxed);
        self.state.seek_request.store(-1, Ordering::Relaxed);
        self.current_path = path.to_string();

        Ok(duration)
    }

    pub fn play(&mut self, path: &str) -> Result<(), String> {
        if path == self.current_path && self.stream.is_some() {
            if let Some(ref stream) = self.stream {
                stream.play().map_err(|e| e.to_string())?;
                self.state.playing.store(true, Ordering::Relaxed);
                return Ok(());
            }
        }

        self.stop_internal();
        self.current_path = path.to_string();

        let (duration, source_sr, channels) = decoder::probe_info(path)?;
        let channels_usize = channels as usize;

        // Figure out the device output rate so we can resample if needed.
        let device_sr = output::device_sample_rate().unwrap_or(source_sr);

        // Always use device rate for position tracking.
        self.state.sample_rate.store(device_sr, Ordering::Relaxed);
        self.state.channels.store(channels, Ordering::Relaxed);
        self.state.duration_secs.store(duration);
        self.state
            .position_samples
            .store(0, Ordering::Relaxed);
        self.state.seek_request.store(-1, Ordering::Relaxed);
        self.state.stop_flag.store(false, Ordering::Relaxed);

        // Ring buffer is always sized for device rate.
        let ring_samples = RING_BUFFER_FRAMES * channels_usize;
        let rb = SpscRb::<f32>::new(ring_samples);
        let prod = rb.producer();
        let cons = rb.consumer();

        // Build resampler when source rate differs from device rate.
        let resampler = if source_sr != device_sr {
            Some(AudioResampler::new(source_sr, device_sr, channels_usize, RING_BUFFER_FRAMES)
                .map_err(|e| format!("Resampler: {}", e))?)
        } else {
            None
        };

        let decoder_state = Arc::clone(&self.state);
        let decoder_path = path.to_string();
        let handle = thread::Builder::new()
            .name("audio-decoder".into())
            .spawn(move || {
                decoder::decode_loop(&decoder_path, decoder_state, prod, resampler);
            })
            .map_err(|e| e.to_string())?;
        self.decoder_handle = Some(handle);

        let mode = self.mode;
        let stream = output::create_stream(mode, cons, Arc::clone(&self.state))?;
        stream.play().map_err(|e| e.to_string())?;
        self.stream = Some(stream);
        self.state.playing.store(true, Ordering::Relaxed);

        Ok(())
    }

    pub fn pause(&self) {
        if let Some(ref stream) = self.stream {
            stream.pause().ok();
        }
        self.state.playing.store(false, Ordering::Relaxed);
    }

    pub fn stop(&mut self) {
        self.stop_internal();
    }

    pub fn seek(&self, seconds: f64) {
        let sr = self.state.sample_rate.load(Ordering::Relaxed);
        if sr > 0 {
            let sample = (seconds * sr as f64) as i64;
            self.state.seek_request.store(sample, Ordering::Relaxed);
            self.state
                .position_samples
                .store(sample.max(0) as u64, Ordering::Relaxed);
        }
    }

    pub fn set_volume(&self, vol: u32) {
        self.state
            .volume
            .store(vol.min(100), Ordering::Relaxed);
    }

    pub fn get_position(&self) -> f64 {
        let sr = self.state.sample_rate.load(Ordering::Relaxed);
        if sr > 0 {
            self.state.position_samples.load(Ordering::Relaxed) as f64 / sr as f64
        } else {
            0.0
        }
    }

    pub fn get_duration(&self) -> f64 {
        self.state.duration_secs.load()
    }

    pub fn is_playing(&self) -> bool {
        self.state.playing.load(Ordering::Relaxed)
    }

    pub fn get_volume(&self) -> u32 {
        self.state.volume.load(Ordering::Relaxed)
    }

    pub fn set_mode(&mut self, mode: AudioMode) {
        let was_playing = self.state.playing.load(Ordering::Relaxed);
        let path = self.current_path.clone();

        if was_playing && !path.is_empty() {
            self.stop_internal();
            self.mode = mode;
            let _ = self.play(&path);
        } else {
            self.mode = mode;
        }
    }

    pub fn get_mode(&self) -> AudioMode {
        self.mode
    }

    fn stop_internal(&mut self) {
        self.state.stop_flag.store(true, Ordering::Relaxed);
        self.state.playing.store(false, Ordering::Relaxed);

        self.stream = None;

        if let Some(handle) = self.decoder_handle.take() {
            let _ = handle.join();
        }

        self.state.stop_flag.store(false, Ordering::Relaxed);
    }
}
