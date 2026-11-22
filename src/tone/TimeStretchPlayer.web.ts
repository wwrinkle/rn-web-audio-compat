// TimeStretchPlayer in a browser: Tone's GrainPlayer, which also keeps pitch when playbackRate changes.
import { GrainPlayer } from 'tone';

export class TimeStretchPlayer extends GrainPlayer {
  readonly name: string = 'TimeStretchPlayer';
}
