#include <rnwac/Installer.h>

#include <audioapi/compatibility/StableAPI.h>
#include <rnwac/KernelNodeHostObjects.h>
#include <rnwac/Kernels.h>

#include <cmath>
#include <memory>
#include <string>
#include <vector>

namespace rnwac {

using namespace facebook;

namespace {

constexpr const char *kTag = "[rn-web-audio-compat] ";

std::shared_ptr<audioapi::BaseAudioContext> contextOrThrow(jsi::Runtime &rt, const jsi::Value &arg) {
  if (arg.isObject()) {
    auto host = arg.asObject(rt).getHostObject<audioapi::BaseAudioContextHostObject>(rt);
    if (host != nullptr) {
      return host->getContext();
    }
  }
  throw jsi::JSError(rt, std::string(kTag) + "first argument is not a react-native-audio-api context");
}

int kernelIdOrThrow(jsi::Runtime &rt, const jsi::Value &arg) {
  const int id = arg.isNumber() ? static_cast<int>(arg.asNumber()) : 0;
  if (kernelName(id) == nullptr) {
    throw jsi::JSError(rt, std::string(kTag) + "no native kernel registered with id " + std::to_string(id));
  }
  return id;
}

std::vector<double> paramsOf(jsi::Runtime &rt, const jsi::Value &arg) {
  std::vector<double> out;
  if (!arg.isObject()) {
    return out;
  }
  auto array = arg.asObject(rt).asArray(rt);
  const size_t n = array.size(rt);
  out.reserve(n);
  for (size_t i = 0; i < n; ++i) {
    out.push_back(array.getValueAtIndex(rt, i).asNumber());
  }
  return out;
}

void setFunction(
    jsi::Runtime &rt,
    const char *name,
    unsigned int argCount,
    jsi::HostFunctionType fn) {
  rt.global().setProperty(
      rt, name, jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, name), argCount, std::move(fn)));
}

} // namespace

void install(jsi::Runtime &runtime) {
  setFunction(runtime, "__rnwacCreateKernelEffectNode", 4, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
    if (count < 2) {
      throw jsi::JSError(rt, std::string(kTag) + "__rnwacCreateKernelEffectNode(context, kernelId, params, tailSeconds)");
    }
    auto context = contextOrThrow(rt, args[0]);
    const int id = kernelIdOrThrow(rt, args[1]);
    auto params = count > 2 ? paramsOf(rt, args[2]) : std::vector<double>{};
    const double tailSeconds = count > 3 && args[3].isNumber() ? args[3].asNumber() : 0.0;
    const int tailFrames = tailSeconds > 0 ? static_cast<int>(std::ceil(tailSeconds * context->getSampleRate())) : 0;
    auto host = std::make_shared<KernelEffectNodeHostObject>(context, id, params, tailFrames);
    return jsi::Object::createFromHostObject(rt, host);
  });

  setFunction(runtime, "__rnwacCreateKernelSourceNode", 3, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
    if (count < 2) {
      throw jsi::JSError(rt, std::string(kTag) + "__rnwacCreateKernelSourceNode(context, kernelId, params)");
    }
    auto context = contextOrThrow(rt, args[0]);
    const int id = kernelIdOrThrow(rt, args[1]);
    auto params = count > 2 ? paramsOf(rt, args[2]) : std::vector<double>{};
    auto host = std::make_shared<KernelSourceNodeHostObject>(context, id, params);
    return jsi::Object::createFromHostObject(rt, host);
  });

  setFunction(runtime, "__rnwacKernelTimings", 0, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *, size_t) {
    std::vector<jsi::Object> rows;
    for (int id = 1; id < kMaxKernelIds; ++id) {
      const char *name = kernelName(id);
      if (name == nullptr) {
        continue;
      }
      const auto &t = g_kernelTiming[id];
      const auto n = t.count.load(std::memory_order_relaxed);
      jsi::Object row(rt);
      row.setProperty(rt, "id", id);
      row.setProperty(rt, "name", jsi::String::createFromUtf8(rt, name));
      row.setProperty(rt, "count", static_cast<double>(n));
      row.setProperty(
          rt, "avgUs", n > 0 ? static_cast<double>(t.totalNs.load(std::memory_order_relaxed)) / n / 1000.0 : 0.0);
      row.setProperty(rt, "maxUs", static_cast<double>(t.maxNs.load(std::memory_order_relaxed)) / 1000.0);
      rows.push_back(std::move(row));
    }
    jsi::Array out(rt, rows.size());
    for (size_t i = 0; i < rows.size(); ++i) {
      out.setValueAtIndex(rt, i, std::move(rows[i]));
    }
    return out;
  });

  setFunction(runtime, "__rnwacResetKernelTimings", 0, [](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) {
    resetKernelTiming();
    return jsi::Value::undefined();
  });
}

} // namespace rnwac
