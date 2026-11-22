// QueuePlayer plays long audio gaplessly from chunks loaded on demand, so a whole recording never has to be in memory.
// `load(index)` returns the chunk (an AudioBuffer or ToneAudioBuffer), or null after the last one. Give it a new buffer
// each time: on React Native the queue takes over a buffer's storage.

import { Gain } from 'tone/build/esm/core/context/Gain.js';
import { ToneAudioNode, type ToneAudioNodeOptions } from 'tone/build/esm/core/context/ToneAudioNode.js';
import { optionsFromArguments } from 'tone/build/esm/core/util/Defaults.js';

export type QueueChunkLoader = (index: number) => unknown | Promise<unknown>;

export interface QueuePlayerOptions extends ToneAudioNodeOptions {
  load: QueueChunkLoader;
  bufferAhead: number; // chunks kept queued
  onended: () => void;
  onerror: (error: unknown) => void;
}

export interface QueueSink {
  enqueue(buffer: unknown): void;
  start(when: number): void;
  stop(when: number): void;
}

const rawBuffer = (chunk: unknown): unknown => {
  const tone = chunk as { get?: () => unknown };
  return typeof tone.get === 'function' ? tone.get() : chunk;
};

export abstract class QueuePlayerBase extends ToneAudioNode<QueuePlayerOptions> {
  readonly name: string = 'QueuePlayer';
  readonly input = undefined;
  readonly output: Gain;
  onended: () => void;
  private readonly _load: QueueChunkLoader;
  private readonly _bufferAhead: number;
  private readonly _onerror: (error: unknown) => void;
  private _session = 0;
  private _pumping = -1;
  private _sink: QueueSink | null = null;
  private _index = 0;
  private _queued = 0;
  private _exhausted = false;

  constructor(options: Partial<QueuePlayerOptions> & Pick<QueuePlayerOptions, 'load'>) {
    const merged = optionsFromArguments(QueuePlayerBase.getDefaults(), [options] as unknown as IArguments) as QueuePlayerOptions;
    super(merged);
    this.output = new Gain({ context: this.context });
    this._load = merged.load;
    this._bufferAhead = Math.max(1, merged.bufferAhead);
    this.onended = merged.onended;
    this._onerror = merged.onerror;
  }

  static getDefaults(): QueuePlayerOptions {
    return Object.assign(ToneAudioNode.getDefaults(), {
      load: () => null,
      bufferAhead: 2,
      onended: () => {},
      onerror: (error: unknown) => console.error('QueuePlayer:', error),
    });
  }

  protected abstract _createSink(onChunkEnded: () => void): QueueSink;

  get state(): 'started' | 'stopped' {
    return this._sink ? 'started' : 'stopped';
  }

  async start(time?: number | string): Promise<this> {
    this.stop();
    const session = ++this._session;
    this._index = 0;
    this._queued = 0;
    this._exhausted = false;
    const sink = this._createSink(() => {
      if (session !== this._session) return;
      this._queued--;
      void this._pump(session, sink);
    });
    this._sink = sink;
    const when = this.toSeconds(time);
    await this._pump(session, sink);
    if (session === this._session && this._queued > 0) {
      sink.start(Math.max(when, this.context.currentTime));
    }
    return this;
  }

  stop(time?: number | string): this {
    if (this._sink) {
      const sink = this._sink;
      this._sink = null;
      this._session++;
      sink.stop(time === undefined ? this.context.currentTime : this.toSeconds(time));
    }
    return this;
  }

  private async _pump(session: number, sink: QueueSink): Promise<void> {
    if (this._pumping === session) return;
    this._pumping = session;
    try {
      while (session === this._session && !this._exhausted && this._queued < this._bufferAhead) {
        const chunk = await this._load(this._index);
        if (session !== this._session) return;
        if (chunk === null || chunk === undefined) {
          this._exhausted = true;
          break;
        }
        this._index++;
        this._queued++;
        sink.enqueue(rawBuffer(chunk));
      }
    } catch (error) {
      this._exhausted = true;
      this._onerror(error);
    } finally {
      if (this._pumping === session) this._pumping = -1;
    }
    if (session === this._session && this._exhausted && this._queued === 0) {
      this.stop();
      this.onended();
    }
  }

  dispose(): this {
    super.dispose();
    this.stop();
    this.output.dispose();
    return this;
  }
}
