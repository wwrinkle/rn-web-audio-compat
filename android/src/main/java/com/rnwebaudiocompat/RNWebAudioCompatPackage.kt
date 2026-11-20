package com.rnwebaudiocompat

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Stub package so React Native autolinking includes this library as a Gradle project. The TurboModule is a pure C++
 * module registered through autolinking's cxx module provider (react-native.config.js cxxModule* fields), the same
 * way react-native-audio-worklets does it.
 */
class RNWebAudioCompatPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { emptyMap() }
}
