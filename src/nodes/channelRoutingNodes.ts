// Narrow shim for ChannelMergerNode/ChannelSplitterNode — react-native-
// audio-api has neither (confirmed: absent from its exports, no
// createChannelMerger/createChannelSplitter on BaseAudioContext), but
// superdough/superdoughoutput.mjs's SuperdoughOutput class — the DEFAULT
// output routing used for every sound, not an optional feature — builds
// one unconditionally in its constructor, and every voice gets split then
// remerged through one on its way to the destination.
//
// NOT a general, spec-accurate implementation. Real ChannelMergerNode/
// ChannelSplitterNode support genuine per-channel-index routing via the
// 3-argument `connect(destination, output, input)` overload — but
// react-native-audio-api's own AudioNode.connect() only has a single-
// argument signature at all (confirmed: reading AudioNode.ts's actual
// runtime implementation, only `destination` is ever read; extra
// arguments are silently accepted and ignored by plain JS semantics, not
// validated or rejected). A true implementation isn't buildable as a thin
// wrapper over this library's primitives at all.
//
// What IS buildable, and what this is: for the common case (a single
// stereo destination, no multi-channel "orbit" routing — the only case
// this project exercises), superdoughoutput.mjs's actual channel-index
// arithmetic reduces to the identity mapping (splitting a stereo signal
// into two mono streams, then remerging them at the SAME indices, is
// mathematically a pure pass-through). So both of these are just thin
// GainNode subclasses — real Web Audio nodes already sum every connected
// input automatically, so "merging" falls out for free, and a "splitter"
// only needs to exist as something to connect FROM.
//
// Confirmed this doesn't double-sum a signal even though
// SuperdoughOutput's default routing calls `.connect()` on the same
// splitter→merger pair multiple times (once per channel index, which we
// collapse to the same plain connect each time): react-native-audio-api's
// own native graph (HostGraph::addEdge, see CLAUDE.md's "native graph
// rejects cycles" section) rejects a duplicate edge between the same node
// pair outright — the second call is silently a no-op, matching the real
// Web Audio spec's own idempotent-connect behavior.
//
// KNOWN LIMITATION, by design (narrow scope, not a bug): multi-channel
// "orbit" routing (different voices routed to different destination
// channel pairs) is NOT supported — every voice collapses onto the same
// shared stereo bus regardless of which channel indices superdough
// requests. Fine for this project's current single-stereo-output usage;
// would need a real implementation (or a native extension) if orbit
// routing is ever actually needed.

import { GainNode, type BaseAudioContext } from 'react-native-audio-api';

export interface ChannelMergerOptions {
  numberOfInputs?: number;
}

export class ChannelMergerNode extends GainNode {
  constructor(context: BaseAudioContext, _options?: ChannelMergerOptions) {
    super(context);
  }
}

export interface ChannelSplitterOptions {
  numberOfOutputs?: number;
}

export class ChannelSplitterNode extends GainNode {
  constructor(context: BaseAudioContext, _options?: ChannelSplitterOptions) {
    super(context);
  }
}
