#include <rnwac/Installer.h>
#include <rnwac/NativeWebAudioCompatModule.h>

#include <memory>
#include <utility>

namespace facebook::react {

NativeWebAudioCompatModule::NativeWebAudioCompatModule(std::shared_ptr<CallInvoker> jsInvoker)
    : NativeWebAudioCompatModuleCxxSpec(std::move(jsInvoker)) {}

bool NativeWebAudioCompatModule::install(jsi::Runtime &runtime) {
  rnwac::install(runtime);
  return true;
}

} // namespace facebook::react
