#pragma once

// JS handles for KernelEffectNode / KernelSourceNode. Each adds setKernelParam(index, value) (applied on the audio thread
// at the next render quantum) and kernelId (read-only) to react-native-audio-api's node host objects.

#include <audioapi/compatibility/StableAPI.h>
#include <rnwac/KernelNodes.h>

#include <jsi/jsi.h>
#include <memory>
#include <vector>

namespace rnwac {

using namespace facebook;

class KernelEffectNodeHostObject : public audioapi::AudioNodeHostObject {
 public:
  KernelEffectNodeHostObject(
      const std::shared_ptr<audioapi::BaseAudioContext> &context,
      int kernelId,
      const std::vector<double> &params,
      int tailFrames);

  JSI_HOST_FUNCTION_DECL(setKernelParam);
  JSI_PROPERTY_GETTER_DECL(kernelId);

 private:
  KernelEffectNode *const kernelNode_;
};

class KernelSourceNodeHostObject : public audioapi::AudioScheduledSourceNodeHostObject {
 public:
  KernelSourceNodeHostObject(
      const std::shared_ptr<audioapi::BaseAudioContext> &context,
      int kernelId,
      const std::vector<double> &params);

  JSI_HOST_FUNCTION_DECL(setKernelParam);
  JSI_PROPERTY_GETTER_DECL(kernelId);

 private:
  KernelSourceNode *const kernelNode_;
};

} // namespace rnwac
