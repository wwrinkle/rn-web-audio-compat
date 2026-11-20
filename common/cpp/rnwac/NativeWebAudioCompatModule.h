#pragma once

// Pure C++ TurboModule (same shape as react-native-audio-worklets). Generated spec: src/specs/NativeWebAudioCompatModule.ts
// (codegenConfig name "rnwebaudiocompat").
#include <rnwebaudiocompatJSI.h>

#include <jsi/jsi.h>
#include <memory>

namespace facebook::react {

class NativeWebAudioCompatModule : public NativeWebAudioCompatModuleCxxSpec<NativeWebAudioCompatModule> {
 public:
  explicit NativeWebAudioCompatModule(std::shared_ptr<CallInvoker> jsInvoker);

  bool install(jsi::Runtime &runtime);
};

} // namespace facebook::react
