// Shows a device harness's log lines (log.ts). The harness itself runs outside React: `start` is idempotent.
import { useEffect, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { logLines } from './log';

export function makeLogScreen(title: string, start: () => Promise<void>) {
  return function LogScreen() {
    const dark = useColorScheme() === 'dark';
    const lines = useSyncExternalStore(logLines.subscribe, logLines.getSnapshot);
    useEffect(() => {
      void start();
    }, []);
    const fg = dark ? '#eee' : '#111';
    return (
      <View style={[styles.container, { backgroundColor: dark ? '#111' : '#fff' }]}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Text style={[styles.title, { color: fg }]}>{title}</Text>
        <ScrollView>
          {lines.map((line, i) => (
            <Text
              key={i}
              style={[styles.line, { color: line.startsWith('FAIL') ? '#d33' : line.startsWith('PASS') ? '#2a2' : fg }]}
            >
              {line}
            </Text>
          ))}
        </ScrollView>
      </View>
    );
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 48, paddingHorizontal: 12 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  line: { fontFamily: 'monospace', fontSize: 11, marginBottom: 2 },
});
