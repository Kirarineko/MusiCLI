use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};

pub struct AudioResampler {
    inner: SincFixedIn<f32>,
    channels: usize,
    chunk_size: usize,
    input_rate: u32,
    output_rate: u32,
    /// Accumulated input samples (interleaved) not yet processed.
    buffer: Vec<f32>,
}

impl AudioResampler {
    pub fn new(
        input_rate: u32,
        output_rate: u32,
        channels: usize,
        chunk_size: usize,
    ) -> Result<Self, String> {
        let ratio = output_rate as f64 / input_rate as f64;
        let params = SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 256,
            window: WindowFunction::BlackmanHarris2,
        };

        let resampler =
            SincFixedIn::<f32>::new(ratio, 2.0, params, chunk_size, channels)
                .map_err(|e| format!("Resampler error: {}", e))?;

        Ok(Self {
            inner: resampler,
            channels,
            chunk_size,
            input_rate,
            output_rate,
            buffer: Vec::new(),
        })
    }

    /// Discard buffered samples and reset the resampler to a fresh state.
    /// Must be called after seeking.
    pub fn reset(&mut self) {
        self.buffer.clear();
        let ratio = self.output_rate as f64 / self.input_rate as f64;
        let params = SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 256,
            window: WindowFunction::BlackmanHarris2,
        };
        if let Ok(inner) = SincFixedIn::<f32>::new(
            ratio, 2.0, params, self.chunk_size, self.channels,
        ) {
            self.inner = inner;
        }
    }

    /// Resample interleaved f32 samples.  Accepts any number of input frames;
    /// buffers them internally and produces a full resampled block whenever
    /// enough input has accumulated.
    pub fn process(&mut self, input: &[f32]) -> Result<Vec<f32>, String> {
        // Append new samples to the internal buffer.
        self.buffer.extend_from_slice(input);

        let mut output = Vec::new();
        let required = self.chunk_size * self.channels;

        while self.buffer.len() >= required {
            // Take exactly one chunk of interleaved samples.
            let chunk: Vec<f32> = self.buffer.drain(..required).collect();

            // Deinterleave.
            let frames = self.chunk_size;
            let mut deinterleaved: Vec<Vec<f32>> =
                vec![vec![0.0; frames]; self.channels];
            for (i, sample) in chunk.iter().enumerate() {
                let ch = i % self.channels;
                let frame = i / self.channels;
                deinterleaved[ch][frame] = *sample;
            }

            // Process through SincFixedIn.
            let resampled = self
                .inner
                .process(&deinterleaved, None)
                .map_err(|e| format!("Resample error: {}", e))?;

            // Re-interleave output.
            for (i, _) in resampled[0].iter().enumerate() {
                for ch_data in &resampled {
                    output.push(ch_data[i]);
                }
            }
        }

        Ok(output)
    }
}
