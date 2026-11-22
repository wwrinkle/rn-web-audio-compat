// Tone.js's AudioWorklet processors on React Native. Tone passes their source to audioWorklet.addModule() as a Blob URL,
// which can't load code here. So its two processors are registered under Tone's names, backed by C++ kernels, and the URL
// is a placeholder (addModule() resolves without loading anything).
//
// Tone connects signals to these params and schedules ramps on them (Freeverb's roomSize, PluckSynth's release). So each
// param is the `offset` of a ConstantSourceNode, a real AudioParam, fed to the kernel through a KernelControlNode.

import type { AudioNode, BaseAudioContext, ConstantSourceNode } from 'react-native-audio-api';
import { createKernelNode } from '../kernels/nativeKernels';
import { createKernelControlNode } from '../native/nativeModule';
import { Context } from 'tone/build/esm/core/context/Context.js';
import { AudioWorkletNode, registerNativeProcessor } from '../worklet/AudioWorkletNode';

const WORKLET_URL = 'rn-web-audio-compat:tone-worklets';

export function createControlledKernelNode(
  context: BaseAudioContext,
  name: string,
  options?: Record<string, unknown>
): AudioNode {
  const { node, entry } = createKernelNode(context, name, undefined, options);
  const parameters = new Map<string, ConstantSourceNode['offset']>();
  const controls: { source: ConstantSourceNode; control: AudioNode }[] = [];
  entry.module.parameterDescriptors.forEach((descriptor, index) => {
    const source = context.createConstantSource();
    source.offset.value = descriptor.defaultValue;
    const control = createKernelControlNode(context, node, index);
    source.connect(control);
    control.connect(node);
    source.start();
    parameters.set(descriptor.name, source.offset);
    controls.push({ source, control }); // held by `port`: releasing a node's JS handle removes it from the graph
  });
  const port = {
    onmessage: null,
    postMessage(message: unknown) {
      if (message !== 'dispose') return;
      for (const { source, control } of controls.splice(0)) {
        source.stop();
        source.disconnect();
        control.disconnect();
      }
    },
  };
  return Object.assign(node, { parameters, port });
}

type UrlWithObjectUrls = { createObjectURL?: (blob: unknown) => string };

let installed = false;

export function installToneWorklets(): void {
  if (installed) return;
  installed = true;
  for (const name of ['bit-crusher', 'feedback-comb-filter']) {
    registerNativeProcessor(name, (context) => createControlledKernelNode(context, name));
  }
  // Tone goes through standardized-audio-context's AudioWorkletNode, which is undefined outside a browser's secure
  // context, and the failure is lost in a promise. On the prototype so that offline contexts get this too.
  const contextPrototype = Context.prototype as unknown as Record<string, unknown>;
  contextPrototype.addAudioWorkletModule = async () => {};
  contextPrototype.createAudioWorkletNode = function (this: Context, name: string, options?: Record<string, unknown>) {
    return new AudioWorkletNode(this.rawContext as unknown as BaseAudioContext, name, options);
  };
  const url = (globalThis as unknown as { URL: UrlWithObjectUrls }).URL;
  const createObjectURL = url.createObjectURL?.bind(url);
  url.createObjectURL = (blob) =>
    (blob as { type?: string } | null)?.type === 'text/javascript' || !createObjectURL
      ? WORKLET_URL
      : createObjectURL(blob);
}
