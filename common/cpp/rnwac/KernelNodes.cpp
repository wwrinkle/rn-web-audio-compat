#include <rnwac/KernelNodes.h>

#include <algorithm>
#include <chrono>
#include <utility>

namespace rnwac {

KernelRunner::KernelRunner(int kernelId, const std::vector<double> &params) : kernelId_(kernelId) {
  const size_t n = std::min(params.size(), static_cast<size_t>(kMaxParams));
  for (size_t i = 0; i < n; ++i) {
    params_[i] = params[i];
  }
  for (auto &ch : scratch_) {
    ch.assign(static_cast<size_t>(audioapi::RENDER_QUANTUM_SIZE), 0.0f);
  }
}

void KernelRunner::setParam(int index, double value) {
  if (index >= 0 && index < kMaxParams) {
    params_[index] = value;
  }
}

void KernelRunner::run(
    audioapi::DSPAudioBuffer &buffer,
    size_t offset,
    size_t frames,
    bool hasInput,
    double sampleRate,
    double time) {
  for (int i = 0; i < kMaxParams; ++i) {
    if (controls_->active[i]) {
      params_[i] = controls_->value[i];
    }
  }

  const size_t channels = std::min(buffer.getNumberOfChannels(), static_cast<size_t>(kMaxChannels));
  const float *inPtrs[kMaxChannels] = {};
  float *outPtrs[kMaxChannels] = {};
  for (size_t ch = 0; ch < channels; ++ch) {
    float *data = buffer.getChannel(ch)->begin() + offset;
    if (hasInput) {
      if (scratch_[ch].size() < frames) {
        scratch_[ch].resize(frames); // only if a quantum is ever larger than RENDER_QUANTUM_SIZE
      }
      std::copy(data, data + frames, scratch_[ch].begin());
      inPtrs[ch] = scratch_[ch].data();
    }
    outPtrs[ch] = data;
  }

  const auto start = std::chrono::steady_clock::now();
  runKernel(
      kernelId_,
      hasInput ? inPtrs : nullptr,
      outPtrs,
      static_cast<int>(channels),
      static_cast<int>(frames),
      params_,
      state_,
      sampleRate,
      time);
  recordKernelTiming(
      kernelId_,
      static_cast<uint64_t>(
          std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - start).count()));

  // Channels beyond what kernels handle stay silent.
  for (size_t ch = channels; ch < buffer.getNumberOfChannels(); ++ch) {
    buffer.getChannel(ch)->zero(offset, frames);
  }
}

audioapi::AudioNodeOptions effectNodeOptions(int tailFrames) {
  audioapi::AudioNodeOptions options;
  options.channelCount = 2;
  options.channelCountMode = audioapi::ChannelCountMode::EXPLICIT;
  options.requiresTailProcessing = tailFrames > 0;
  return options;
}

audioapi::AudioScheduledSourceNodeOptions sourceNodeOptions() {
  audioapi::AudioScheduledSourceNodeOptions options;
  options.channelCount = 2;
  options.channelCountMode = audioapi::ChannelCountMode::EXPLICIT;
  return options;
}

audioapi::AudioNodeOptions controlNodeOptions() {
  audioapi::AudioNodeOptions options;
  options.channelCount = 1;
  options.channelCountMode = audioapi::ChannelCountMode::EXPLICIT;
  return options;
}

KernelControlNode::KernelControlNode(
    const std::shared_ptr<audioapi::BaseAudioContext> &context,
    const audioapi::AudioNodeOptions &options,
    std::shared_ptr<KernelControls> controls,
    int paramIndex)
    : audioapi::AudioNode(context, options), controls_(std::move(controls)), paramIndex_(paramIndex) {}

void KernelControlNode::processNode(int framesToProcess) {
  auto buffer = getOutputBuffer();
  if (framesToProcess > 0 && paramIndex_ >= 0 && paramIndex_ < kMaxParams) {
    controls_->value[paramIndex_] = buffer->getChannel(0)->begin()[0];
    controls_->active[paramIndex_] = true;
  }
  buffer->zero();
}

FeedbackSendNode::FeedbackSendNode(
    const std::shared_ptr<audioapi::BaseAudioContext> &context,
    const audioapi::AudioNodeOptions &options,
    std::shared_ptr<FeedbackBus> bus)
    : audioapi::AudioNode(context, options), bus_(std::move(bus)) {}

void FeedbackSendNode::processNode(int framesToProcess) {
  auto buffer = getOutputBuffer();
  auto context = context_.lock();
  if (context != nullptr && framesToProcess > 0) {
    const size_t frame = context->getCurrentSampleFrame();
    const size_t slot = (frame / audioapi::RENDER_QUANTUM_SIZE) & 1;
    const size_t frames = std::min(static_cast<size_t>(framesToProcess), static_cast<size_t>(audioapi::RENDER_QUANTUM_SIZE));
    const size_t channels = buffer->getNumberOfChannels();
    for (size_t ch = 0; ch < 2 && channels > 0; ++ch) {
      const float *data = buffer->getChannel(std::min(ch, channels - 1))->begin();
      std::copy(data, data + frames, bus_->samples[slot][ch]);
    }
    bus_->blockFrame[slot] = frame;
  }
  buffer->zero();
}

FeedbackReturnNode::FeedbackReturnNode(
    const std::shared_ptr<audioapi::BaseAudioContext> &context,
    const audioapi::AudioScheduledSourceNodeOptions &options,
    std::shared_ptr<FeedbackBus> bus)
    : audioapi::AudioScheduledSourceNode(context, options), bus_(std::move(bus)) {}

void FeedbackReturnNode::processNode(int framesToProcess) {
  audioBuffer_->zero();
  auto context = context_.lock();
  if (framesToProcess <= 0 || context == nullptr || isUnscheduled() || isFinished()) {
    return;
  }
  size_t startOffset = 0;
  auto nonSilentFrames = static_cast<size_t>(framesToProcess);
  updatePlaybackInfo(
      audioBuffer_,
      framesToProcess,
      startOffset,
      nonSilentFrames,
      context->getSampleRate(),
      context->getCurrentSampleFrame());
  if ((!isPlaying() && !isStopScheduled()) || nonSilentFrames == 0) {
    return;
  }
  const size_t frame = context->getCurrentSampleFrame();
  const size_t quantum = audioapi::RENDER_QUANTUM_SIZE;
  const size_t slot = ((frame / quantum) & 1) ^ 1;
  if (frame >= quantum && bus_->blockFrame[slot] == frame - quantum) {
    const size_t end = std::min(startOffset + nonSilentFrames, quantum);
    for (size_t ch = 0; ch < std::min(audioBuffer_->getNumberOfChannels(), static_cast<size_t>(2)); ++ch) {
      std::copy(bus_->samples[slot][ch] + startOffset, bus_->samples[slot][ch] + end, audioBuffer_->getChannel(ch)->begin() + startOffset);
    }
  }
  handleStopScheduled();
}

KernelEffectNode::KernelEffectNode(
    const std::shared_ptr<audioapi::BaseAudioContext> &context,
    const audioapi::AudioNodeOptions &options,
    int kernelId,
    const std::vector<double> &params,
    int tailFrames)
    : audioapi::AudioNode(context, options), runner_(kernelId, params), tailFrames_(tailFrames) {
  runner_.prepare(context->getSampleRate());
}

void KernelEffectNode::processNode(int framesToProcess) {
  if (framesToProcess <= 0) {
    return;
  }
  auto context = context_.lock();
  if (context == nullptr) {
    getOutputBuffer()->zero();
    return;
  }
  runner_.run(
      *getOutputBuffer(),
      0,
      static_cast<size_t>(framesToProcess),
      true,
      context->getSampleRate(),
      context->getCurrentTime());
}

KernelSourceNode::KernelSourceNode(
    const std::shared_ptr<audioapi::BaseAudioContext> &context,
    const audioapi::AudioScheduledSourceNodeOptions &options,
    int kernelId,
    const std::vector<double> &params)
    : audioapi::AudioScheduledSourceNode(context, options), runner_(kernelId, params) {}

// Same playback bookkeeping as react-native-audio-worklets' WorkletSourceNode (the stable API's reference source node).
void KernelSourceNode::processNode(int framesToProcess) {
  if (framesToProcess <= 0) {
    return;
  }
  if (isUnscheduled() || isFinished()) {
    audioBuffer_->zero();
    return;
  }
  auto context = context_.lock();
  if (context == nullptr) {
    audioBuffer_->zero();
    return;
  }

  size_t startOffset = 0;
  auto nonSilentFrames = static_cast<size_t>(framesToProcess);
  updatePlaybackInfo(
      audioBuffer_,
      framesToProcess,
      startOffset,
      nonSilentFrames,
      context->getSampleRate(),
      context->getCurrentSampleFrame());

  if ((!isPlaying() && !isStopScheduled()) || nonSilentFrames == 0) {
    audioBuffer_->zero();
    return;
  }

  // Time of the first rendered frame, as the 0.13 kernels expected.
  const double time = context->getCurrentTime() + static_cast<double>(startOffset) / context->getSampleRate();
  runner_.run(*audioBuffer_, startOffset, nonSilentFrames, false, context->getSampleRate(), time);
  handleStopScheduled();
}

} // namespace rnwac
