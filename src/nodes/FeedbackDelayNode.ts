// FeedbackDelayNode: a delay with feedback in one node, `new FeedbackDelayNode(context, wet, time, feedback)`, with
// live `delayTime` / `feedback` / `wet` params. Its output is the wet signal only: connect the dry path separately.
// It exists because the usual graph-cycle feedback delay doesn't work on react-native-audio-api (docs/FINDINGS.md, "The
// native graph rejects cycles"). Runs the C++ 'feedback-delay' kernel while native processors are enabled (its tail
// keeps ringing after the input stops), otherwise feedbackDelayProcessor.ts as a JS worklet (kept running by a silent
// source, since worklet nodes have no tail-time; disconnect() stops it).

import { AudioNode, type BaseAudioContext } from 'react-native-audio-api';
import type { LiveAudioParam } from '../worklet/liveAudioParam';
import { feedbackDelayProcessor } from '../processors/feedbackDelayProcessor';
import { buildDualModeNode, startKeepAlive } from './dualModeNode';

export class FeedbackDelayNode extends AudioNode {
  readonly delayTime: LiveAudioParam;
  readonly feedback: LiveAudioParam;
  readonly wet: LiveAudioParam;
  private readonly keepAlive?: { stop: () => void };

  constructor(context: BaseAudioContext, wet: number, time: number, feedback: number) {
    const built = buildDualModeNode(context, feedbackDelayProcessor, 'feedback-delay', {
      delayTime: time,
      feedback: Math.min(Math.abs(feedback), 0.995),
      wet: Math.abs(wet),
    });
    super(context, built.handle as ConstructorParameters<typeof AudioNode>[1]);
    // Kernel params implement the same value/automation surface callers use.
    this.delayTime = built.params.delayTime as LiveAudioParam;
    this.feedback = built.params.feedback as LiveAudioParam;
    this.wet = built.params.wet as LiveAudioParam;
    if (!built.native) this.keepAlive = startKeepAlive(context, this);
  }

  disconnect(...args: unknown[]): void {
    try {
      this.keepAlive?.stop();
    } catch {
      // already stopped
    }
    (super.disconnect as (...a: unknown[]) => void)(...args);
  }
}
