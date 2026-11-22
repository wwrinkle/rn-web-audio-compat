// QueuePlayer on react-native-audio-api's AudioBufferQueueSourceNode (see QueuePlayerBase.ts).
import type { AudioBuffer, BaseAudioContext } from 'react-native-audio-api';
import { connect } from 'tone/build/esm/core/context/ToneAudioNode.js';
import { QueuePlayerBase, type QueueSink } from './QueuePlayerBase';

export type { QueueChunkLoader, QueuePlayerOptions } from './QueuePlayerBase';

export class QueuePlayer extends QueuePlayerBase {
  protected _createSink(onChunkEnded: () => void): QueueSink {
    const node = (this.context.rawContext as unknown as BaseAudioContext).createBufferQueueSource();
    connect(node as never, this.output);
    node.onbufferended = onChunkEnded;
    return {
      enqueue: (buffer) => void node.enqueueBuffer(buffer as AudioBuffer),
      start: (when) => node.start(when),
      stop: (when) => {
        node.onbufferended = null;
        try {
          node.stop(when);
        } catch {
          // never started, or already ended
        }
        node.disconnect();
      },
    };
  }
}
