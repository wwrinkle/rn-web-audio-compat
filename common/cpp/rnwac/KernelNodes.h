#pragma once

// rn-web-audio-compat's own audio nodes: they run a registered C++ kernel (Kernels.h) on the audio thread, built on
// react-native-audio-api's stable extension API (the only react-native-audio-api include allowed is StableAPI.h). This
// replaces the 0.13.x patch that taught react-native-audio-api's worklet nodes a setKernel() mode.

#include <audioapi/compatibility/StableAPI.h>
#include <rnwac/Kernels.h>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <vector>

namespace rnwac {

// Param values written by KernelControlNodes and read by the kernel's runner, both on the audio thread. Shared ownership,
// so either node can be released first.
struct KernelControls {
  double value[kMaxParams] = {};
  bool active[kMaxParams] = {};
};

// Shared by both node kinds: the kernel id, its flat params and state, plus the per-node scratch input (react-native-
// audio-api 1.0 processes in place, so input and output are the same buffer; kernels need `out` not to alias `in`).
class KernelRunner {
 public:
  KernelRunner(int kernelId, const std::vector<double> &params);

  // Audio thread only (called from a scheduled audio event).
  void setParam(int index, double value);

  // Runs the kernel over `frames` frames of `buffer`, starting at `offset`. With `hasInput`, the buffer's current
  // contents are the input; otherwise (sources) the kernel gets in == nullptr.
  void run(audioapi::DSPAudioBuffer &buffer, size_t offset, size_t frames, bool hasInput, double sampleRate, double time);

  [[nodiscard]] int kernelId() const {
    return kernelId_;
  }

  [[nodiscard]] const std::shared_ptr<KernelControls> &controls() const {
    return controls_;
  }

  void prepare(double sampleRate) {
    prepareKernel(kernelId_, state_, params_, sampleRate);
  }

 private:
  const int kernelId_;
  const std::shared_ptr<KernelControls> controls_ = std::make_shared<KernelControls>();
  double params_[kMaxParams] = {};
  KernelState state_;
  std::vector<float> scratch_[kMaxChannels];
};

// An effect kernel: one input, one output, always stereo (channelCountMode explicit, 2 channels, so a mono input is
// up-mixed by the graph, as the 0.13 patch did by hand). `tailFrames` > 0 keeps the node rendering that long after its
// input goes silent (delay and reverb tails).
class KernelEffectNode : public audioapi::AudioNode {
 public:
  KernelEffectNode(
      const std::shared_ptr<audioapi::BaseAudioContext> &context,
      const audioapi::AudioNodeOptions &options,
      int kernelId,
      const std::vector<double> &params,
      int tailFrames);
  DELETE_COPY_AND_MOVE(KernelEffectNode);

  void setParam(int index, double value) {
    runner_.setParam(index, value);
  }

  [[nodiscard]] int kernelId() const {
    return runner_.kernelId();
  }

  [[nodiscard]] const std::shared_ptr<KernelControls> &controls() const {
    return runner_.controls();
  }

 protected:
  void processNode(int framesToProcess) override;
  [[nodiscard]] int computeTailFrames() const override {
    return tailFrames_;
  }

 private:
  KernelRunner runner_;
  const int tailFrames_;
};

// A source kernel (no input), scheduled with start()/stop() like any AudioScheduledSourceNode.
class KernelSourceNode : public audioapi::AudioScheduledSourceNode {
 public:
  KernelSourceNode(
      const std::shared_ptr<audioapi::BaseAudioContext> &context,
      const audioapi::AudioScheduledSourceNodeOptions &options,
      int kernelId,
      const std::vector<double> &params);
  DELETE_COPY_AND_MOVE(KernelSourceNode);

  void setParam(int index, double value) {
    runner_.setParam(index, value);
  }

  [[nodiscard]] int kernelId() const {
    return runner_.kernelId();
  }

 protected:
  void processNode(int framesToProcess) override;

 private:
  KernelRunner runner_;
};

// Drives one kernel param from the audio graph. Connected source -> control node -> kernel node, it runs before the kernel,
// stores its input's first sample of the block as the param (k-rate) and outputs silence. With a ConstantSourceNode as the
// source, the kernel param gets a real AudioParam: automation and modulation inputs work, which setKernelParam can't do.
class KernelControlNode : public audioapi::AudioNode {
 public:
  KernelControlNode(
      const std::shared_ptr<audioapi::BaseAudioContext> &context,
      const audioapi::AudioNodeOptions &options,
      std::shared_ptr<KernelControls> controls,
      int paramIndex);
  DELETE_COPY_AND_MOVE(KernelControlNode);

 protected:
  void processNode(int framesToProcess) override;

 private:
  const std::shared_ptr<KernelControls> controls_;
  const int paramIndex_;
};

// A feedback loop the audio graph can't reject: react-native-audio-api drops any connection that closes a cycle. The send
// node stores each block and outputs silence (connect it to the destination so it is rendered); the return node, a source
// with no graph edge from the send, plays that block one render quantum later: the delay Web Audio gives a cycle.
struct FeedbackBus {
  float samples[2][2][audioapi::RENDER_QUANTUM_SIZE] = {};
  size_t blockFrame[2] = {SIZE_MAX, SIZE_MAX};
};

class FeedbackSendNode : public audioapi::AudioNode {
 public:
  FeedbackSendNode(
      const std::shared_ptr<audioapi::BaseAudioContext> &context,
      const audioapi::AudioNodeOptions &options,
      std::shared_ptr<FeedbackBus> bus);
  DELETE_COPY_AND_MOVE(FeedbackSendNode);

 protected:
  void processNode(int framesToProcess) override;

 private:
  const std::shared_ptr<FeedbackBus> bus_;
};

class FeedbackReturnNode : public audioapi::AudioScheduledSourceNode {
 public:
  FeedbackReturnNode(
      const std::shared_ptr<audioapi::BaseAudioContext> &context,
      const audioapi::AudioScheduledSourceNodeOptions &options,
      std::shared_ptr<FeedbackBus> bus);
  DELETE_COPY_AND_MOVE(FeedbackReturnNode);

 protected:
  void processNode(int framesToProcess) override;

 private:
  const std::shared_ptr<FeedbackBus> bus_;
};

audioapi::AudioNodeOptions controlNodeOptions();
audioapi::AudioNodeOptions effectNodeOptions(int tailFrames);
audioapi::AudioScheduledSourceNodeOptions sourceNodeOptions();

} // namespace rnwac
