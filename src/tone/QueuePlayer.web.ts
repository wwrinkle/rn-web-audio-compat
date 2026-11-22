// QueuePlayer in a browser: buffer sources scheduled back to back (see QueuePlayerBase.ts).
import { connect } from 'tone/build/esm/core/context/ToneAudioNode.js';
import { QueuePlayerBase, type QueueSink } from './QueuePlayerBase';

export type { QueueChunkLoader, QueuePlayerOptions } from './QueuePlayerBase';

type WebSource = {
  buffer: unknown;
  onended: (() => void) | null;
  start(when: number): void;
  stop(when?: number): void;
  disconnect(): void;
};

export class QueuePlayer extends QueuePlayerBase {
  protected _createSink(onChunkEnded: () => void): QueueSink {
    const context = this.context;
    const output = this.output;
    const pending: unknown[] = [];
    const active = new Set<WebSource>();
    let next = -1;
    const schedule = (buffer: unknown) => {
      const source = context.createBufferSource() as unknown as WebSource;
      source.buffer = buffer;
      connect(source as never, output);
      source.onended = () => {
        active.delete(source);
        source.disconnect();
        onChunkEnded();
      };
      source.start(next);
      active.add(source);
      next += (buffer as { duration: number }).duration;
    };
    return {
      enqueue: (buffer) => (next < 0 ? pending.push(buffer) : schedule(buffer)),
      start: (when) => {
        next = when;
        pending.splice(0).forEach(schedule);
      },
      stop: (when) => {
        for (const source of active) {
          source.onended = null;
          source.stop(when);
        }
        active.clear();
      },
    };
  }
}
