// Codegen spec for rn-web-audio-compat's pure C++ TurboModule (common/cpp/rnwac/NativeWebAudioCompatModule.*).
// install() puts the __rnwac* JSI globals on the JS runtime (common/cpp/rnwac/Installer.h).
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  install(): boolean;
}

export default TurboModuleRegistry.get<Spec>('NativeWebAudioCompatModule');
