// A tiny synthesized WAV file, generated in pure JS — used to test the
// native sample decode/playback pathway (`context.decodeAudioData()` +
// `AudioBufferSourceNode`) without depending on a bundled asset or a
// network fetch. Real superdough loads real drum/instrument samples this
// same way (fetch -> ArrayBuffer -> decodeAudioData), just from a URL
// instead of a hand-built buffer — this isolates the actual native
// decoder/playback mechanics, which is the part that's actually new here.
//
// Encodes a short decaying plucked-string-ish tone (fundamental + a
// couple of harmonics, exponential decay, slight downward pitch glide) —
// deliberately not a pure sine, so it's audibly distinguishable from the
// existing oscillator demos and reads as "a sample," not "another tone."

export function createTestWavArrayBuffer(sampleRate: number, durationSeconds = 0.6): ArrayBuffer {
  const frameCount = Math.floor(sampleRate * durationSeconds);
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = frameCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  // RIFF/WAVE header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const baseFreq = 220;
  let phase1 = 0;
  let phase2 = 0;
  for (let n = 0; n < frameCount; n++) {
    const t = n / sampleRate;
    const decay = Math.exp(-t * 6);
    const glide = 1 - 0.15 * (t / durationSeconds);
    const freq1 = baseFreq * glide;
    const freq2 = baseFreq * 2 * glide;
    phase1 += (2 * Math.PI * freq1) / sampleRate;
    phase2 += (2 * Math.PI * freq2) / sampleRate;
    const sample = decay * (0.7 * Math.sin(phase1) + 0.3 * Math.sin(phase2));
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + n * bytesPerSample, Math.round(clamped * 32767), true);
  }

  return buffer;
}
