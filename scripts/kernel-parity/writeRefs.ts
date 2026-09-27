/// <reference types="node" />
// Reference data for the C++ kernel parity check. Each case runs a JS processor module (the spec) over deterministic
// multi-block input and writes params + input + expected output to <outDir>/<name>.txt; parity.cpp then runs the C++
// kernel with the same id on the same data and compares sample by sample (run.sh). Used by this library's tests and by
// extension libraries' (e.g. rn-strudel) for their own kernels.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WorkletProcessorModule } from '../../src/worklet/types';

export interface ParityCase {
  name: string;
  kernelId: number; // must match the C++ registration
  module: WorkletProcessorModule<any>;
  values?: Record<string, number>;
  options?: Record<string, unknown>; // processorOptions passed to createState
  extraParams?: number[]; // appended after the descriptor params (the kernel's documented layout)
  blocks?: number;
  prepareState?: (state: unknown) => void; // e.g. preset random phases to match the C++ RNG
}

const SR = 48000;
const FRAMES = 128;
const BLOCKS = 60;
const T0 = 1.0;

function fmt(a: Float32Array | number[]): string {
  return Array.from(a, (x) => Number(x).toPrecision(9)).join(' ');
}

export function parityOutDir(): string {
  return process.env.KERNEL_PARITY_OUT ?? path.join(os.tmpdir(), 'rnwac-kernel-parity');
}

export function writeParityRefs(cases: ParityCase[], outDir = parityOutDir()): void {
  fs.mkdirSync(outDir, { recursive: true });
  for (const c of cases) {
    let lcg = 12345;
    const noise = (): number => {
      lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
      return (lcg >>> 8) / 16777216 - 0.5;
    };
    const params: Record<string, number> = {};
    for (const d of c.module.parameterDescriptors) params[d.name] = c.values?.[d.name] ?? d.defaultValue;
    const state = c.module.createState(SR, c.options);
    c.prepareState?.(state);

    const kernelParams = c.module.parameterDescriptors.map((d) => params[d.name]).concat(c.extraParams ?? []);
    const isSource = c.module.kind === 'source';
    const blocks = c.blocks ?? BLOCKS;
    const lines: string[] = [];
    lines.push(`${c.name} ${c.kernelId} ${isSource ? 1 : 0} 2 ${FRAMES} ${blocks} ${T0} ${FRAMES / SR} ${kernelParams.length}`);
    lines.push(kernelParams.map((x) => Number(x).toPrecision(17)).join(' '));
    for (let b = 0; b < blocks; b++) {
      const t = T0 + (b * FRAMES) / SR;
      const inL = new Float32Array(FRAMES);
      const inR = new Float32Array(FRAMES);
      for (let n = 0; n < FRAMES; n++) {
        const i = b * FRAMES + n;
        inL[n] = 0.6 * (((i * 220) / SR) % 1) * 2 - 0.6 + 0.2 * noise();
        inR[n] = 0.5 * Math.sin((2 * Math.PI * 330 * i) / SR) + 0.2 * noise();
      }
      const outL = new Float32Array(FRAMES);
      const outR = new Float32Array(FRAMES);
      c.module.process(state, isSource ? [] : [inL, inR], [outL, outR], params, FRAMES, SR, t);
      if (!isSource) {
        lines.push(fmt(inL));
        lines.push(fmt(inR));
      }
      lines.push(fmt(outL));
      lines.push(fmt(outR));
    }
    fs.writeFileSync(path.join(outDir, `${c.name}.txt`), lines.join('\n') + '\n');
  }
}
