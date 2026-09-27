#pragma once

// rn-web-audio-compat: native (C++) effect kernels. A patched WorkletProcessingNode (effects) or WorkletSourceNode
// (sources) can run a registered kernel by id instead of calling a JS worklet, so nothing runs in Hermes on the audio
// thread. Deliberately free of any react-native-audio-api types (plain pointers only).
//
// Params are doubles (JS numbers), NOT floats: 32-bit params broke bit-exactness (e.g. floor(0.02 * 48000) became 959).
// They arrive as a flat array: the JS processor's parameterDescriptors in order, then any "extra" params the JS kernel
// entry appends (documented per kernel).
//
// Built-in kernels (this library) use ids 1..99. Extension kernels (another library, e.g. rn-strudel) are added as NEW
// files under dsp/rnwac_ext/ (never by editing these files): if <audioapi/dsp/rnwac_ext/Extensions.h> exists at build
// time, Kernels.cpp calls rnwac_ext::registerKernels() when the registry is first used. Extensions use ids 100..255.

#include <atomic>
#include <cstdint>
#include <vector>

namespace rnwac {

constexpr int kMaxParams = 16;
constexpr int kMaxChannels = 2;
constexpr int kStateSlots = 8;
constexpr int kMaxVoices = 64;
constexpr int kMaxKernelIds = 256;

enum BuiltinKernelId : int {
  kNone = 0,
  kFeedbackDelay = 1,
  kCompressor = 2,
  kFdnReverb = 3,
};

// Per-kernel-id on-device cost tracking (real audio-thread wall time around each runKernel call, see the
// call sites in WorkletProcessingNode.cpp / WorkletSourceNode.cpp). Global rather than per-node: the render thread
// processes the whole graph sequentially, so plain atomics (no contention in practice) avoid any locking on the
// audio thread. Read via BaseAudioContextHostObject's getKernelTimings()/resetKernelTimings() JSI functions.
struct KernelTiming {
  std::atomic<uint64_t> totalNs{0};
  std::atomic<uint64_t> count{0};
  std::atomic<uint64_t> maxNs{0};
};

inline KernelTiming g_kernelTiming[kMaxKernelIds];

inline void recordKernelTiming(int id, uint64_t ns) {
  if (id <= 0 || id >= kMaxKernelIds) {
    return;
  }
  auto &t = g_kernelTiming[id];
  t.totalNs.fetch_add(ns, std::memory_order_relaxed);
  t.count.fetch_add(1, std::memory_order_relaxed);
  uint64_t prevMax = t.maxNs.load(std::memory_order_relaxed);
  while (ns > prevMax && !t.maxNs.compare_exchange_weak(prevMax, ns, std::memory_order_relaxed)) {
  }
}

// Whole-graph render cost (AudioDestinationNode::renderAudio, i.e. everything the audio thread does per
// device callback: event processing, graph pre-processing, every node incl. JS worklets). Reported as entry id 0 of
// getKernelTimings(). Load = render time / real time of the rendered frames; maxLoad is the worst single callback.
struct RenderTiming {
  std::atomic<uint64_t> totalNs{0};
  std::atomic<uint64_t> count{0};
  std::atomic<uint64_t> maxNs{0};
  std::atomic<uint64_t> frames{0};
  std::atomic<uint64_t> maxLoadPermille{0};
  std::atomic<uint64_t> overBudget{0}; // callbacks that took longer than the audio they produced
};

inline RenderTiming g_renderTiming;

inline void recordRenderTiming(uint64_t ns, int frames, float sampleRate) {
  if (frames <= 0 || sampleRate <= 0) {
    return;
  }
  auto &t = g_renderTiming;
  t.totalNs.fetch_add(ns, std::memory_order_relaxed);
  t.count.fetch_add(1, std::memory_order_relaxed);
  t.frames.fetch_add(static_cast<uint64_t>(frames), std::memory_order_relaxed);
  uint64_t prevMax = t.maxNs.load(std::memory_order_relaxed);
  while (ns > prevMax && !t.maxNs.compare_exchange_weak(prevMax, ns, std::memory_order_relaxed)) {
  }
  double budgetNs = static_cast<double>(frames) / static_cast<double>(sampleRate) * 1e9;
  auto loadPermille = static_cast<uint64_t>(static_cast<double>(ns) / budgetNs * 1000.0);
  uint64_t prevLoad = t.maxLoadPermille.load(std::memory_order_relaxed);
  while (loadPermille > prevLoad &&
         !t.maxLoadPermille.compare_exchange_weak(prevLoad, loadPermille, std::memory_order_relaxed)) {
  }
  if (loadPermille >= 1000) {
    t.overBudget.fetch_add(1, std::memory_order_relaxed);
  }
}

inline void resetKernelTiming() {
  for (auto &t : g_kernelTiming) {
    t.totalNs.store(0, std::memory_order_relaxed);
    t.count.store(0, std::memory_order_relaxed);
    t.maxNs.store(0, std::memory_order_relaxed);
  }
  g_renderTiming.totalNs.store(0, std::memory_order_relaxed);
  g_renderTiming.count.store(0, std::memory_order_relaxed);
  g_renderTiming.maxNs.store(0, std::memory_order_relaxed);
  g_renderTiming.frames.store(0, std::memory_order_relaxed);
  g_renderTiming.maxLoadPermille.store(0, std::memory_order_relaxed);
  g_renderTiming.overBudget.store(0, std::memory_order_relaxed);
}

// Per-node scratch state for stateful kernels (zero-initialised).
struct KernelState {
  bool init = false;
  double v[kMaxChannels][kStateSlots] = {};
  double g[kStateSlots] = {};
  int writeIndex = 0;
  std::vector<float> buf[kMaxChannels];
  double phases[kMaxVoices] = {};
  bool phaseInit[kMaxVoices] = {};
  unsigned int rng = 0x9E3779B9u;
  // Kernels needing more than the above (fdnReverb: 8 delay lines + 8 allpasses, and scalar state in x[]).
  std::vector<float> bufs[16];
  int bufIdx[16] = {};
  double x[32] = {};
};

// `in` is null for source kernels. `in`/`out` are per-channel pointers to `frames` samples. `out` must not alias `in`.
// `currentTime` is the time (seconds) of the first frame of the block.
using KernelFn = void (*)(
    const float *const *in,
    float *const *out,
    int channels,
    int frames,
    const double *params,
    KernelState &state,
    double sampleRate,
    double currentTime);

// Adds a kernel to the registry. Only call from rnwac_ext::registerKernels() (registry initialisation); returns false for
// an invalid or already-used id.
bool registerKernel(int id, const char *name, KernelFn fn);

// Name of a registered kernel, or nullptr.
const char *kernelName(int id);

// Runs kernel `id` (zeroes the output if it isn't registered).
void runKernel(
    int id,
    const float *const *in,
    float *const *out,
    int channels,
    int frames,
    const double *params,
    KernelState &state,
    double sampleRate,
    double currentTime);

} // namespace rnwac
