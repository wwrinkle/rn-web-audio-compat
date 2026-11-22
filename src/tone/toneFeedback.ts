// Tone's feedback effects on React Native. FeedbackEffect and StereoFeedbackEffect build a graph cycle in their
// constructors, and react-native-audio-api silently drops the edge that closes a cycle: one echo, no repeats. The hook is
// the assignment of each class's feedback node (a setter on the prototype): that node's connection back into the effect
// goes through a native feedback bridge instead. Each repeat comes one render quantum (128 frames) later than the delay
// time, because the bridge adds that delay on top of the effect's DelayNode.

import { connect } from 'tone/build/esm/core/context/ToneAudioNode.js';
import { FeedbackEffect } from 'tone/build/esm/effect/FeedbackEffect.js';
import { StereoFeedbackEffect } from 'tone/build/esm/effect/StereoFeedbackEffect.js';
import type { BaseAudioContext } from 'react-native-audio-api';
import { createFeedbackBridge } from '../native/nativeModule';

type ToneNode = {
  connect: (...args: unknown[]) => unknown;
  dispose: () => unknown;
};
type Owner = Record<string, unknown> & { context: { rawContext: unknown } };

function bridgeBackInto(owner: Owner, node: ToneNode, targetName: string): void {
  const originalConnect = node.connect;
  const originalDispose = node.dispose;
  let bridge: ReturnType<typeof createFeedbackBridge> | undefined;
  node.connect = function (this: ToneNode, destination: unknown, ...rest: unknown[]) {
    if (destination !== owner[targetName]) return originalConnect.call(this, destination, ...rest);
    bridge ??= createFeedbackBridge(owner.context.rawContext as BaseAudioContext);
    originalConnect.call(this, bridge.send);
    connect(bridge.ret as never, destination as never);
    return this;
  };
  node.dispose = function (this: ToneNode) {
    bridge?.dispose();
    bridge = undefined;
    return originalDispose.call(this);
  };
}

function hookFeedbackNode(prototype: object, property: string, targetName: string): void {
  Object.defineProperty(prototype, property, {
    configurable: true,
    set(this: Owner, node: ToneNode) {
      Object.defineProperty(this, property, { value: node, writable: true, configurable: true, enumerable: true });
      bridgeBackInto(this, node, targetName);
    },
  });
}

let installed = false;

export function installToneFeedback(): void {
  if (installed) return;
  installed = true;
  hookFeedbackNode(FeedbackEffect.prototype, '_feedbackGain', 'effectSend');
  hookFeedbackNode(StereoFeedbackEffect.prototype, '_feedbackMerge', '_split');
  // PingPongDelay rewires its left feedback into its right delay, a second cycle that doesn't pass through _feedbackMerge.
  hookFeedbackNode(StereoFeedbackEffect.prototype, '_feedbackL', '_rightDelay');
}
