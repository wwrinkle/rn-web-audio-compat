#include <audioapi/HostObjects/effects/WorkletProcessingNodeHostObject.h>
#include <audioapi/core/BaseAudioContext.h>

#include <memory>
#include <utility>

namespace audioapi {

WorkletProcessingNodeHostObject::WorkletProcessingNodeHostObject(
    const std::shared_ptr<WorkletProcessingNode> &node)
    : AudioNodeHostObject(node) {
  addFunctions(
      JSI_EXPORT_FUNCTION(WorkletProcessingNodeHostObject, setKernel),
      JSI_EXPORT_FUNCTION(WorkletProcessingNodeHostObject, setKernelParam));
}

JSI_HOST_FUNCTION_IMPL(WorkletProcessingNodeHostObject, setKernel) {
  auto node = std::static_pointer_cast<WorkletProcessingNode>(node_);
  int id = static_cast<int>(args[0].asNumber());
  node->scheduleAudioEvent([node, id](BaseAudioContext &) { node->setKernel(id); });
  return jsi::Value::undefined();
}

JSI_HOST_FUNCTION_IMPL(WorkletProcessingNodeHostObject, setKernelParam) {
  auto node = std::static_pointer_cast<WorkletProcessingNode>(node_);
  int index = static_cast<int>(args[0].asNumber());
  double value = args[1].asNumber();
  node->scheduleAudioEvent([node, index, value](BaseAudioContext &) { node->setKernelParam(index, value); });
  return jsi::Value::undefined();
}

} // namespace audioapi
