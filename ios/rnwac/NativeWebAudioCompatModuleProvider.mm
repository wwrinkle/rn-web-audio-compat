#import "NativeWebAudioCompatModuleProvider.h"

#import <ReactCommon/CallInvoker.h>
#import <ReactCommon/TurboModule.h>
#import <rnwac/NativeWebAudioCompatModule.h>

@implementation NativeWebAudioCompatModuleProvider

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeWebAudioCompatModule>(params.jsInvoker);
}

@end
