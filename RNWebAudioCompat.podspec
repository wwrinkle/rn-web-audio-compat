require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# rn-web-audio-compat's native module (iOS): kernel nodes on react-native-audio-api's stable extension API.
# Modeled on react-native-audio-worklets' RNAudioWorklets.podspec.
Pod::Spec.new do |s|
  s.name         = "RNWebAudioCompat"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]
  s.platforms    = { :ios => '14.0' }
  s.source       = { :git => "https://github.com/wwrinkle/rn-web-audio-compat.git", :tag => "#{s.version}" }

  # rnwac_ext/ holds extension kernels another package copies in (e.g. rn-strudel's apply step).
  s.source_files        = "common/cpp/rnwac/**/*.{cpp,h}", "common/cpp/rnwac_ext/**/*.{cpp,h}", "ios/rnwac/**/*.{mm,h}"
  s.header_mappings_dir = "common/cpp"

  s.dependency 'RNAudioAPI'
  s.dependency 'React-jsi'

  s.pod_target_xcconfig = {
    "USE_HEADERMAP" => "YES",
    "DEFINES_MODULE" => "YES",
    "HEADER_SEARCH_PATHS" => [
      '"$(PODS_TARGET_SRCROOT)/common/cpp"',
      '"$(PODS_ROOT)/RCT-Folly"',
      '"$(PODS_ROOT)/boost"',
      '"$(PODS_ROOT)/DoubleConversion"',
      '"$(PODS_ROOT)/Headers/Private/React-Core"',
      '"$(PODS_ROOT)/Headers/Public/RNAudioAPI"',
      '"$(PODS_ROOT)/Headers/Private/ReactCodegen"',
      '"$(PODS_ROOT)/../build/generated/ios/ReactCodegen"',
    ].join(' '),
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "OTHER_CFLAGS" => "$(inherited) -DRCT_NEW_ARCH_ENABLED",
  }

  install_modules_dependencies(s)
end
