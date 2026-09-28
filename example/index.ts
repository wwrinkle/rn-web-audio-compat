// Browser-style Web Audio globals first (before anything that might touch them at module-evaluation time).
import 'rn-web-audio-compat/globals';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
