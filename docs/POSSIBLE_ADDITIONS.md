# Possible additions

Ideas that could be added someday. Nothing here is planned or scheduled.

## Tone.Recorder and Tone.UserMedia

These two Tone classes don't work on React Native: `Recorder` needs `MediaRecorder` and `UserMedia` needs
`getUserMedia`, and neither exists here. They could be backed by react-native-audio-api's native `AudioRecorder`, with
the same API as Tone's classes and the stock classes in the web build.

Questions anyone picking this up would need to answer:

- Which output format `Recorder.stop()` returns, since a browser returns a `Blob`.
- How microphone permissions and the audio session work on iOS and Android, including alongside playback and the
  Android background notification.
- How recording behaves with the screen locked.
