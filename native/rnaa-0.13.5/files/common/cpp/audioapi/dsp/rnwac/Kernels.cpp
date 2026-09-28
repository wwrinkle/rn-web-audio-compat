#include <audioapi/dsp/rnwac/Kernels.h>
#include <audioapi/dsp/rnwac/KernelUtil.h>

#if __has_include(<audioapi/dsp/rnwac_ext/Extensions.h>)
#include <audioapi/dsp/rnwac_ext/Extensions.h>
#define RNWAC_HAS_EXTENSIONS 1
#endif

#include <algorithm>
#include <cmath>
#include <limits>

namespace rnwac {

namespace {

using namespace rnwac::util;

// ---------------------------------------------------------------------------------------------------------------------
// feedbackDelay: params [delayTime, feedback, wet, maxDelaySeconds]. Port of feedbackDelayProcessor.ts (own circular
// buffer, feedback mixed in software; no graph cycle). writeIndex is shared across channels.
void feedbackDelay(
    const float *const *in,
    float *const *out,
    int channels,
    int frames,
    const double *p,
    KernelState &s,
    double sr) {
  if (!s.init) {
    const double maxSeconds = p[3] > 0 ? p[3] : 2.0;
    const int maxSamples = std::max(2, static_cast<int>(std::ceil(maxSeconds * sr)));
    for (int ch = 0; ch < kMaxChannels; ++ch) {
      s.buf[ch].assign(static_cast<size_t>(maxSamples), 0.0f);
    }
    s.writeIndex = 0;
    s.init = true;
  }
  const int maxSamples = static_cast<int>(s.buf[0].size());
  int delaySamples = static_cast<int>(std::floor(static_cast<double>(p[0]) * sr));
  if (delaySamples < 1) delaySamples = 1;
  if (delaySamples > maxSamples - 1) delaySamples = maxSamples - 1;
  const double feedback = std::min(std::max(static_cast<double>(p[1]), 0.0), 0.995);
  const double wet = p[2];
  const int ch2 = std::min(channels, kMaxChannels);
  int writeIndex = s.writeIndex;
  for (int i = 0; i < frames; ++i) {
    int readIndex = writeIndex - delaySamples;
    if (readIndex < 0) readIndex += maxSamples;
    for (int ch = 0; ch < ch2; ++ch) {
      std::vector<float> &b = s.buf[ch];
      const double delayed = b[static_cast<size_t>(readIndex)];
      const double inSample = in[ch][i];
      b[static_cast<size_t>(writeIndex)] = static_cast<float>(inSample + delayed * feedback);
      out[ch][i] = static_cast<float>(delayed * wet);
    }
    writeIndex += 1;
    if (writeIndex >= maxSamples) writeIndex = 0;
  }
  s.writeIndex = writeIndex;
  for (int ch = ch2; ch < channels; ++ch) {
    for (int n = 0; n < frames; ++n) out[ch][n] = 0.0f;
  }
}


// ---------------------------------------------------------------------------------------------------------------------
// compressor: params [threshold, knee, ratio, attack, release]. Port of compressorProcessor.ts (feedforward soft-knee).
double gainReductionDb(double levelDb, double threshold, double knee, double ratio) {
  if (knee <= 0) {
    return levelDb < threshold ? 0.0 : threshold - levelDb + (levelDb - threshold) / ratio;
  }
  const double kneeStart = threshold - knee / 2.0;
  const double kneeEnd = threshold + knee / 2.0;
  if (levelDb < kneeStart) return 0.0;
  if (levelDb <= kneeEnd) {
    const double x = levelDb - kneeStart;
    return -((1.0 / ratio - 1.0) * x * x) / (2.0 * knee);
  }
  return threshold - levelDb + (levelDb - threshold) / ratio;
}

void compressor(
    const float *const *in,
    float *const *out,
    int channels,
    int frames,
    const double *p,
    KernelState &s,
    double sr) {
  if (!s.init) {
    s.g[0] = -100.0; // envelopeDb
    s.init = true;
  }
  const double threshold = p[0];
  const double knee = std::max(0.0, static_cast<double>(p[1]));
  const double ratio = std::max(1.0, static_cast<double>(p[2]));
  const double attack = std::max(1e-4, static_cast<double>(p[3]));
  const double release = std::max(1e-4, static_cast<double>(p[4]));
  const double attackCoeff = std::exp(-1.0 / (sr * attack));
  const double releaseCoeff = std::exp(-1.0 / (sr * release));
  double env = s.g[0];
  for (int n = 0; n < frames; ++n) {
    double peak = 0.0;
    for (int ch = 0; ch < channels; ++ch) {
      peak = std::max(peak, std::fabs(static_cast<double>(in[ch][n])));
    }
    const double inputDb = peak > 0 ? 20.0 * std::log10(peak) : -100.0;
    const double coeff = inputDb > env ? attackCoeff : releaseCoeff;
    env = coeff * env + (1.0 - coeff) * inputDb;
    const double gr = gainReductionDb(env, threshold, knee, ratio);
    const double gain = std::pow(10.0, gr / 20.0);
    for (int ch = 0; ch < channels; ++ch) {
      out[ch][n] = static_cast<float>(static_cast<double>(in[ch][n]) * gain);
    }
  }
  s.g[0] = env;
}


// ---------------------------------------------------------------------------------------------------------------------
// fdnReverb: params [decayTime, fadeInTime, lpFreqStart, lpFreqEnd]. Mirrors src/processors/
// fdnReverbProcessor.ts (the spec; see its header for the design). State: bufs[0..7] delay lines, bufs[8..15] allpasses
// (first 4 left, last 4 right); x[0..7] damping, x[8..15] line gains, x[16..17] input lowpass, x[18..20] the params the
// coefficients were computed for, x[21] aIn, x[22] aDamp, x[23] outGain.
constexpr int kFdnLineLengths48k[8] = {1601, 1867, 2053, 2251, 2399, 2617, 2797, 3011};
constexpr int kFdnAllpassLengths48k[8] = {142, 107, 379, 277, 151, 113, 389, 263};
constexpr double kInvSqrt8 = 0.35355339059327373;

inline double fdnFlush(double v) {
  return (v > -1e-15 && v < 1e-15) ? 0.0 : v;
}

inline double onePolePower(double a, double w) {
  return (a * a) / (1 - 2 * (1 - a) * std::cos(w) + (1 - a) * (1 - a));
}

void fdnReverb(
    const float *const *in,
    float *const *out,
    int channels,
    int frames,
    const double *p,
    KernelState &s,
    double sr) {
  if (!s.init) {
    const double scale = sr / 48000.0;
    for (int i = 0; i < 8; ++i) {
      s.bufs[i].assign(static_cast<size_t>(std::max(1.0, std::round(kFdnLineLengths48k[i] * scale))), 0.0f);
      s.bufs[8 + i].assign(static_cast<size_t>(std::max(1.0, std::round(kFdnAllpassLengths48k[i] * scale))), 0.0f);
      s.bufIdx[i] = 0;
      s.bufIdx[8 + i] = 0;
    }
    for (double &v : s.x) v = 0.0;
    s.x[18] = s.x[19] = s.x[20] = std::numeric_limits<double>::quiet_NaN();
    s.x[21] = 1.0;
    s.x[22] = 1.0;
    s.init = true;
  }
  double *damp = s.x;
  double *lineGain = s.x + 8;
  double *inLp = s.x + 16;
  double *config = s.x + 18;

  const double decayTime = jsMax(0.05, p[0]);
  const double lpStart = p[2];
  const double lpEnd = p[3];
  if (decayTime != config[0] || lpStart != config[1] || lpEnd != config[2]) {
    config[0] = decayTime;
    config[1] = lpStart;
    config[2] = lpEnd;
    const double nyquistish = 0.45 * sr;
    double meanLen = 0;
    for (int i = 0; i < 8; ++i) meanLen += static_cast<double>(s.bufs[i].size());
    meanLen /= 8;
    for (int i = 0; i < 8; ++i) {
      lineGain[i] = std::pow(10.0, (-3.0 * static_cast<double>(s.bufs[i].size())) / (decayTime * sr));
    }
    if (lpStart > 0) {
      s.x[21] = 1 - std::exp((-2 * kPi * jsMin(lpStart, nyquistish)) / sr);
      const double passes = jsMax(1.0, (decayTime * sr) / meanLen);
      double fcLoop = lpEnd > 0 ? lpEnd / std::sqrt(std::pow(2.0, 1 / passes) - 1) : nyquistish;
      fcLoop = jsMin(jsMax(fcLoop, jsMax(lpEnd, 20.0)), nyquistish);
      s.x[22] = 1 - std::exp((-2 * kPi * fcLoop) / sr);
    } else {
      s.x[21] = 1.0;
      s.x[22] = 1.0;
    }
    const double meanGain = std::pow(10.0, (-3 * meanLen) / (decayTime * sr));
    constexpr int bins = 64;
    double estimate = 0;
    for (int m = 0; m < bins; ++m) {
      const double w = (kPi * (m + 0.5)) / bins;
      const double loop = meanGain * meanGain * onePolePower(s.x[22], w);
      estimate += onePolePower(s.x[21], w) / (1 - loop);
    }
    estimate /= bins;
    const double calibration = (0.00125 * 44100) / sr;
    const double target = calibration * calibration * std::round(1.5 * decayTime * sr);
    s.x[23] = std::sqrt(target / estimate);
  }

  const float *inL = in[0];
  const float *inR = channels > 1 ? in[1] : in[0];
  float *outL = out[0];
  float *outR = channels > 1 ? out[1] : nullptr;
  const double aIn = s.x[21];
  const double aDamp = s.x[22];
  const double g = 0.6;
  const double tap = s.x[23] * kInvSqrt8;
  double w[8];
  double d[8];

  for (int n = 0; n < frames; ++n) {
    inLp[0] += aIn * (static_cast<double>(inL[n]) - inLp[0]);
    inLp[1] += aIn * (static_cast<double>(inR[n]) - inLp[1]);
    double uL = inLp[0];
    double uR = inLp[1];
    for (int k = 0; k < 8; ++k) {
      std::vector<float> &buf = s.bufs[8 + k];
      const int idx = s.bufIdx[8 + k];
      const double delayed = buf[static_cast<size_t>(idx)];
      const double xin = k < 4 ? uL : uR;
      const double y = -g * xin + delayed;
      const double v = xin + g * y;
      buf[static_cast<size_t>(idx)] = static_cast<float>(fdnFlush(v));
      s.bufIdx[8 + k] = idx + 1 >= static_cast<int>(buf.size()) ? 0 : idx + 1;
      if (k < 4) {
        uL = y;
      } else {
        uR = y;
      }
    }

    for (int i = 0; i < 8; ++i) {
      const double di = s.bufs[i][static_cast<size_t>(s.bufIdx[i])];
      d[i] = di;
      const double z = damp[i] + aDamp * (di - damp[i]);
      damp[i] = fdnFlush(z);
      w[i] = lineGain[i] * damp[i];
    }
    for (int h = 1; h < 8; h *= 2) {
      for (int i = 0; i < 8; i += 2 * h) {
        for (int j = i; j < i + h; ++j) {
          const double a = w[j];
          const double b = w[j + h];
          w[j] = a + b;
          w[j + h] = a - b;
        }
      }
    }
    for (int i = 0; i < 8; ++i) {
      std::vector<float> &buf = s.bufs[i];
      const int idx = s.bufIdx[i];
      const double v = w[i] * kInvSqrt8 + ((i & 1) == 0 ? uL : uR);
      buf[static_cast<size_t>(idx)] = static_cast<float>(fdnFlush(v));
      s.bufIdx[i] = idx + 1 >= static_cast<int>(buf.size()) ? 0 : idx + 1;
    }

    const double l = d[0] + d[1] + d[2] + d[3] - d[4] - d[5] - d[6] - d[7];
    const double r = d[0] + d[1] - d[2] - d[3] + d[4] + d[5] - d[6] - d[7];
    outL[n] = static_cast<float>(l * tap);
    if (outR) outR[n] = static_cast<float>(r * tap);
  }
}


// ---------------------------------------------------------------------------------------------------------------------
// Registry. Filled once, on first use (thread-safe function-local static), before any kernel runs.

struct Entry {
  const char *name = nullptr;
  KernelFn fn = nullptr;
};

Entry g_registry[kMaxKernelIds];

void feedbackDelayEntry(
    const float *const *in, float *const *out, int channels, int frames, const double *p, KernelState &s, double sr, double) {
  feedbackDelay(in, out, channels, frames, p, s, sr);
}
void compressorEntry(
    const float *const *in, float *const *out, int channels, int frames, const double *p, KernelState &s, double sr, double) {
  compressor(in, out, channels, frames, p, s, sr);
}
void fdnReverbEntry(
    const float *const *in, float *const *out, int channels, int frames, const double *p, KernelState &s, double sr, double) {
  fdnReverb(in, out, channels, frames, p, s, sr);
}

bool initRegistry() {
  registerKernel(kFeedbackDelay, "feedback-delay", feedbackDelayEntry);
  registerKernel(kCompressor, "compressor", compressorEntry);
  registerKernel(kFdnReverb, "fdn-reverb", fdnReverbEntry);
#ifdef RNWAC_HAS_EXTENSIONS
  rnwac_ext::registerKernels();
#endif
  return true;
}

void ensureRegistry() {
  static const bool initialised = initRegistry();
  (void)initialised;
}

} // namespace

bool registerKernel(int id, const char *name, KernelFn fn) {
  if (id <= 0 || id >= kMaxKernelIds || fn == nullptr || g_registry[id].fn != nullptr) {
    return false;
  }
  g_registry[id] = Entry{name, fn};
  return true;
}

const char *kernelName(int id) {
  ensureRegistry();
  if (id <= 0 || id >= kMaxKernelIds) return nullptr;
  return g_registry[id].name;
}

void runKernel(
    int id,
    const float *const *in,
    float *const *out,
    int channels,
    int frames,
    const double *params,
    KernelState &state,
    double sampleRate,
    double currentTime) {
  ensureRegistry();
  KernelFn fn = (id > 0 && id < kMaxKernelIds) ? g_registry[id].fn : nullptr;
  if (fn == nullptr) {
    zeroOut(out, channels, frames);
    return;
  }
  fn(in, out, channels, frames, params, state, sampleRate, currentTime);
}

} // namespace rnwac
