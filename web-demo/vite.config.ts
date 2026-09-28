import { defineConfig } from 'vite';

// The conformance suite lives one directory up (shared with the Expo example app).
export default defineConfig({
  server: { fs: { allow: ['..'] } },
});
