#include <rnwac/KernelNodeHostObjects.h>

#include <memory>
#include <utility>

namespace rnwac {

namespace {

// Applies a param change on the audio thread. The captured graph handle keeps the node alive until the event runs (the
// same pattern react-native-audio-api's own host objects use).
template <typename Node>
void scheduleParam(
    const std::shared_ptr<audioapi::utils::graph::NodeHandle> &handle,
    Node *node,
    int index,
    double value) {
  node->scheduleAudioEvent([handle, node, index, value](audioapi::BaseAudioContext &) {
    node->setParam(index, value);
  });
}

} // namespace

KernelEffectNodeHostObject::KernelEffectNodeHostObject(
    const std::shared_ptr<audioapi::BaseAudioContext> &context,
    int kernelId,
    const std::vector<double> &params,
    int tailFrames)
    : audioapi::AudioNodeHostObject(
          context->getGraph(),
          std::make_unique<KernelEffectNode>(context, effectNodeOptions(tailFrames), kernelId, params, tailFrames),
          effectNodeOptions(tailFrames)),
      kernelNode_(static_cast<KernelEffectNode *>(audioNode_)) {
  addFunctions(JSI_EXPORT_FUNCTION(KernelEffectNodeHostObject, setKernelParam));
  addGetters(JSI_EXPORT_PROPERTY_GETTER(KernelEffectNodeHostObject, kernelId));
}

JSI_HOST_FUNCTION_IMPL(KernelEffectNodeHostObject, setKernelParam) {
  scheduleParam(
      node_->handle, kernelNode_, static_cast<int>(args[0].asNumber()), args[1].asNumber());
  return jsi::Value::undefined();
}

JSI_PROPERTY_GETTER_IMPL(KernelEffectNodeHostObject, kernelId) {
  return {kernelNode_->kernelId()};
}

KernelControlNodeHostObject::KernelControlNodeHostObject(
    const std::shared_ptr<audioapi::BaseAudioContext> &context,
    const std::shared_ptr<KernelControls> &controls,
    int paramIndex)
    : audioapi::AudioNodeHostObject(
          context->getGraph(),
          std::make_unique<KernelControlNode>(context, controlNodeOptions(), controls, paramIndex),
          controlNodeOptions()) {}

FeedbackSendNodeHostObject::FeedbackSendNodeHostObject(
    const std::shared_ptr<audioapi::BaseAudioContext> &context,
    const std::shared_ptr<FeedbackBus> &bus)
    : audioapi::AudioNodeHostObject(
          context->getGraph(),
          std::make_unique<FeedbackSendNode>(context, effectNodeOptions(0), bus),
          effectNodeOptions(0)) {}

FeedbackReturnNodeHostObject::FeedbackReturnNodeHostObject(
    const std::shared_ptr<audioapi::BaseAudioContext> &context,
    const std::shared_ptr<FeedbackBus> &bus)
    : audioapi::AudioScheduledSourceNodeHostObject(
          context->getGraph(),
          std::make_unique<FeedbackReturnNode>(context, sourceNodeOptions(), bus),
          sourceNodeOptions()) {}

KernelSourceNodeHostObject::KernelSourceNodeHostObject(
    const std::shared_ptr<audioapi::BaseAudioContext> &context,
    int kernelId,
    const std::vector<double> &params)
    : audioapi::AudioScheduledSourceNodeHostObject(
          context->getGraph(),
          std::make_unique<KernelSourceNode>(context, sourceNodeOptions(), kernelId, params),
          sourceNodeOptions()),
      kernelNode_(static_cast<KernelSourceNode *>(audioNode_)) {
  addFunctions(JSI_EXPORT_FUNCTION(KernelSourceNodeHostObject, setKernelParam));
  addGetters(JSI_EXPORT_PROPERTY_GETTER(KernelSourceNodeHostObject, kernelId));
}

JSI_HOST_FUNCTION_IMPL(KernelSourceNodeHostObject, setKernelParam) {
  scheduleParam(
      node_->handle, kernelNode_, static_cast<int>(args[0].asNumber()), args[1].asNumber());
  return jsi::Value::undefined();
}

JSI_PROPERTY_GETTER_IMPL(KernelSourceNodeHostObject, kernelId) {
  return {kernelNode_->kernelId()};
}

} // namespace rnwac
