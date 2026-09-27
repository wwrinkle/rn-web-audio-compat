// Android keeps audio alive under screen lock only while a foreground
// service of type mediaPlayback is running; react-native-audio-api starts
// that service (declared by its Expo plugin) when a playback notification is
// shown. Android 13+ also needs the POST_NOTIFICATIONS runtime permission
// or the notification (and so the service) never appears. iOS handles this
// via UIBackgroundModes: audio, so this is a no-op there.

import { PermissionsAndroid, Platform } from 'react-native';
import { PlaybackNotificationManager } from 'react-native-audio-api';

let permissionRequested = false;

async function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android' || Platform.Version < 33 || permissionRequested) {
    return;
  }
  permissionRequested = true;
  await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
}

export async function startBackgroundPlayback(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await ensureNotificationPermission();
    await PlaybackNotificationManager.show({ title: 'Sound Walk', artist: 'Playing', state: 'playing' });
  } catch (err) {
    console.log('[BACKGROUND-PLAYBACK] start failed', err);
  }
}

export async function stopBackgroundPlayback(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await PlaybackNotificationManager.hide();
  } catch (err) {
    console.log('[BACKGROUND-PLAYBACK] stop failed', err);
  }
}
