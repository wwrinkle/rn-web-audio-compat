#pragma once

#include <jsi/jsi.h>

namespace rnwac {

// Installs rn-web-audio-compat's JSI globals on the JS runtime (called by NativeWebAudioCompatModule.install()):
//   __rnwacCreateKernelEffectNode(context, kernelId, params: number[], tailSeconds) -> node host object
//   __rnwacCreateKernelSourceNode(context, kernelId, params: number[])              -> source node host object
//   __rnwacKernelTimings() -> { id, name, count, avgUs, maxUs }[] for every registered kernel
//   __rnwacResetKernelTimings()
// `context` is react-native-audio-api's native context object (the JS BaseAudioContext's `.context`).
void install(facebook::jsi::Runtime &runtime);

} // namespace rnwac
