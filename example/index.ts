// Browser-style Web Audio globals first (before anything that might touch them at module-evaluation time).
import 'rn-web-audio-compat/globals';
import { registerRootComponent } from 'expo';

// EXPO_PUBLIC_AUTORUN (inlined at build time): '1' runs the conformance suite on launch; 'stress' and 'tone' run the
// device harnesses in ./harness instead of the app. The harnesses load with require() so that only the chosen one's
// modules evaluate ('tone' makes the app's AudioContext as it loads).
/* eslint-disable @typescript-eslint/no-require-imports */
const mode = process.env.EXPO_PUBLIC_AUTORUN;
if (mode === 'stress') {
  const { makeLogScreen } = require('./harness/LogScreen');
  registerRootComponent(makeLogScreen('Stress tests', require('./harness/stress').startStress));
} else if (mode === 'tone') {
  const { makeLogScreen } = require('./harness/LogScreen');
  registerRootComponent(makeLogScreen('Tone.js', require('./harness/tone').startToneHarness));
} else {
  registerRootComponent(require('./App').default);
}
