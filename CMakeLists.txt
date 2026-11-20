# rn-web-audio-compat's native module (Android): kernel nodes on react-native-audio-api's stable extension API.
# Linked into the app by autolinking (react-native.config.js cxxModule* fields). iOS: RNWebAudioCompat.podspec.
cmake_minimum_required(VERSION 3.13)
project(rn-web-audio-compat)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# rnwac/ is this library; rnwac_ext/ holds extension kernels another package copies in (e.g. rn-strudel's apply step).
file(GLOB_RECURSE RNWAC_SOURCES CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/common/cpp/rnwac/*.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/common/cpp/rnwac_ext/*.cpp")

add_library(rn-web-audio-compat STATIC ${RNWAC_SOURCES})

target_compile_definitions(rn-web-audio-compat PRIVATE RCT_NEW_ARCH_ENABLED)
target_compile_options(rn-web-audio-compat PRIVATE -O3)

target_include_directories(rn-web-audio-compat PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/common/cpp")

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)
find_package(react-native-audio-api REQUIRED CONFIG)

target_link_libraries(rn-web-audio-compat
  fbjni::fbjni
  ReactAndroid::jsi
  ReactAndroid::reactnative
  react_codegen_rnwebaudiocompat
  react-native-audio-api::react-native-audio-api
  android
  log
)
