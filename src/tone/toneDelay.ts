// Tone's Delay on React Native. react-native-audio-api 1.0.1 ignores signals connected to DelayNode.delayTime, and at a
// delayTime of 0 the node delays by its maximum, so Chorus, PingPongDelay and PitchShift came out about a second late.
// Tone's contexts make a C++ 'modulated-delay' node instead, whose delayTime is a real AudioParam.

import { Delay } from 'tone/build/esm/core/context/Delay.js';
import { Context } from 'tone/build/esm/core/context/Context.js';
import type { BaseAudioContext } from 'react-native-audio-api';
import { createControlledKernelNode } from './toneWorklets';

type DelayNodeLike = { parameters: Map<string, unknown>; port: { postMessage: (message: unknown) => void } };

let installed = false;

export function installToneDelay(): void {
  if (installed) return;
  installed = true;
  const contextPrototype = Context.prototype as unknown as Record<string, unknown>;
  contextPrototype.createDelay = function (this: Context, maxDelayTime = 1) {
    const node = createControlledKernelNode(this.rawContext as unknown as BaseAudioContext, 'modulated-delay', {
      maxDelayTime,
    }) as unknown as DelayNodeLike;
    return Object.assign(node, { delayTime: node.parameters.get('delayTime') });
  };
  const delayPrototype = Delay.prototype as unknown as { dispose: () => unknown };
  const dispose = delayPrototype.dispose;
  delayPrototype.dispose = function (this: { _delayNode?: DelayNodeLike }) {
    const node = this._delayNode;
    const result = dispose.call(this);
    node?.port.postMessage('dispose'); // stops the delayTime source
    return result;
  };
}
