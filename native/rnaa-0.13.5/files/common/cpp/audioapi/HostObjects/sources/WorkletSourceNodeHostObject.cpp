#include <audioapi/HostObjects/sources/WorkletSourceNodeHostObject.h>
#include <audioapi/core/BaseAudioContext.h>

#include <memory>
#include <utility>

namespace audioapi {

WorkletSourceNodeHostObject::WorkletSourceNodeHostObject(const std::shared_ptr<WorkletSourceNode> &node)
    : AudioScheduledSourceNodeHostObject(node) {
  addFunctions(
      JSI_EXPORT_FUNCTION(WorkletSourceNodeHostObject, setKernel),
      JSI_EXPORT_FUNCTION(WorkletSourceNodeHostObject, setKernelParam));
}

JSI_HOST_FUNCTION_IMPL(WorkletSourceNodeHostObject, setKernel) {
  auto node = std::static_pointer_cast<WorkletSourceNode>(node_);
  int id = static_cast<int>(args[0].asNumber());
  node->scheduleAudioEvent([node, id](BaseAudioContext &) { node->setKernel(id); });
  return jsi::Value::undefined();
}

JSI_HOST_FUNCTION_IMPL(WorkletSourceNodeHostObject, setKernelParam) {
  auto node = std::static_pointer_cast<WorkletSourceNode>(node_);
  int index = static_cast<int>(args[0].asNumber());
  double value = args[1].asNumber();
  node->scheduleAudioEvent([node, index, value](BaseAudioContext &) { node->setKernelParam(index, value); });
  return jsi::Value::undefined();
}

} // namespace audioapi
