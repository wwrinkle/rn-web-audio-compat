// Autolinking for the pure C++ TurboModule (same shape as react-native-audio-worklets).
// Android: android/build.gradle runs codegen; the app's autolinking CMake links react_codegen_rnwebaudiocompat and the
// static rn-web-audio-compat target from the root CMakeLists.txt. iOS: RNWebAudioCompat.podspec +
// NativeWebAudioCompatModuleProvider.
module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: {
        cmakeListsPath: 'build/generated/source/codegen/jni/CMakeLists.txt',
        cxxModuleCMakeListsModuleName: 'rn-web-audio-compat',
        cxxModuleCMakeListsPath: '../CMakeLists.txt',
        cxxModuleHeaderName: 'NativeWebAudioCompatModule',
      },
    },
  },
};
