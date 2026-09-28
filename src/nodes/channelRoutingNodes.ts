// ChannelMergerNode / ChannelSplitterNode (react-native-audio-api has neither): stereo pass-throughs, not real
// per-channel routing. react-native-audio-api's connect() ignores the output/input index arguments, so per-channel
// routing can't be built on top of it. For the common case, splitting a stereo signal and merging it back at the same
// indices, a pass-through gives the same result; code that routes channels elsewhere (e.g. to separate outputs of a
// multichannel device) gets everything on one stereo bus.
//
// Both are explicit-stereo GainNodes: a node sums everything connected to it, so merging comes for free, and a
// splitter only has to exist as something to connect from. Connecting the same pair again once per channel index
// doesn't double the signal: the native graph ignores a duplicate edge.

import { GainNode, type BaseAudioContext } from 'react-native-audio-api';

export interface ChannelMergerOptions {
  numberOfInputs?: number;
}

// Explicit stereo: a plain GainNode processes in place on its input's buffer, so a second consumer of the merger (e.g.
// an AnalyserNode tapping superdough's output) could get an unwritten buffer (docs/FINDINGS.md, "Fan-out").
const explicitStereo = { channelCount: 2, channelCountMode: 'explicit' } as const;

export class ChannelMergerNode extends GainNode {
  constructor(context: BaseAudioContext, _options?: ChannelMergerOptions) {
    super(context, explicitStereo);
  }
}

export interface ChannelSplitterOptions {
  numberOfOutputs?: number;
}

export class ChannelSplitterNode extends GainNode {
  constructor(context: BaseAudioContext, _options?: ChannelSplitterOptions) {
    super(context, explicitStereo);
  }
}
