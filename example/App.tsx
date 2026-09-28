// rn-web-audio-compat example: one button per row of the Web Audio coverage table (COVERAGE.md), each running that
// row's self-test on React Native. The web demo (../web-demo) runs the identical tests against a browser.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Switch, Text, View, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AudioContext } from 'react-native-audio-api';
import { installWebAudioCompat, registerWorkletProcessor } from 'rn-web-audio-compat';
import { GROUPS, ROWS } from '../conformance/rows';
import { runRow, summarize } from '../conformance/tools';
import { TEST_PROCESSOR, testGainModule } from '../conformance/testWorklet';
import type { CoverageRow, TestEnv, TestResult } from '../conformance/types';

registerWorkletProcessor(TEST_PROCESSOR, testGainModule);

function makeEnv(audible: () => boolean): TestEnv {
  return {
    platform: 'native',
    get audible() {
      return audible();
    },
    async createContext(options) {
      const ctx = new AudioContext(options);
      installWebAudioCompat(ctx);
      // Like a browser context, a react-native-audio-api context only starts rendering on resume() (or when the first
      // source starts); the web demo resumes too.
      await ctx.resume();
      return ctx;
    },
    async closeContext(ctx) {
      if (ctx.state !== 'closed') await ctx.close();
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    async prepareTestWorklet(ctx) {
      await ctx.audioWorklet.addModule('rnwac-test-gain');
    },
  };
}

// Stripped-down inline markdown for the table cells: `code` stays, [text](link) keeps the text.
const plain = (md: string) => md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '');

export default function App() {
  const dark = useColorScheme() === 'dark';
  const c = dark ? darkColors : lightColors;
  const [results, setResults] = useState<Map<string, TestResult>>(new Map());
  const [running, setRunning] = useState<string | null>(null);
  const [audible, setAudible] = useState(true);
  const audibleRef = useRef(audible);
  audibleRef.current = audible;
  const env = useMemo(() => makeEnv(() => audibleRef.current), []);

  const record = useCallback((id: string, r: TestResult) => {
    console.log(`[CONFORMANCE] ${r.ok ? 'PASS' : 'FAIL'} ${id}: ${r.detail}`);
    setResults((prev) => new Map(prev).set(id, r));
  }, []);

  const runOne = useCallback(
    async (row: CoverageRow) => {
      setRunning(row.id);
      record(row.id, await runRow(row, env));
      setRunning(null);
    },
    [env, record]
  );

  const runAll = useCallback(async () => {
    const all = new Map<string, TestResult>();
    for (const row of ROWS) {
      if (!row.test) continue;
      console.log(`[CONFORMANCE] start ${row.id}`);
      setRunning(row.id);
      const r = await runRow(row, env);
      all.set(row.id, r);
      record(row.id, r);
    }
    setRunning(null);
    console.log(`[CONFORMANCE] done: ${summarize(all, ROWS)}`);
  }, [env, record]);

  // Built with EXPO_PUBLIC_AUTORUN=1: run everything silently on launch (automated checks; results go to the log).
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_AUTORUN === '1') {
      setAudible(false);
      audibleRef.current = false;
      const id = setTimeout(() => void runAll(), 2000);
      return () => clearTimeout(id);
    }
  }, [runAll]);

  const sections = useMemo(() => GROUPS.map((g) => ({ title: g, data: ROWS.filter((r) => r.group === g) })), []);

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={[styles.bar, { backgroundColor: c.bg }]}>
        <Text style={[styles.title, { color: c.fg }]}>Web Audio conformance</Text>
        <View style={styles.barRow}>
          <Pressable style={[styles.button, { borderColor: c.muted }]} disabled={running !== null} onPress={runAll}>
            <Text style={{ color: c.fg }}>{running ? 'Running…' : 'Run all'}</Text>
          </Pressable>
          <Switch value={audible} onValueChange={setAudible} />
          <Text style={{ color: c.muted }}>play sound</Text>
        </View>
        <Text style={{ color: c.muted }}>{summarize(results, ROWS)}</Text>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => <Text style={[styles.section, { color: c.fg }]}>{section.title}</Text>}
        renderItem={({ item }) => {
          const r = results.get(item.id);
          return (
            <View style={[styles.card, { backgroundColor: c.card }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.name, { color: c.fg }]}>{plain(item.name)}</Text>
                <Text style={[styles.badge, badgeStyle(item.covered, c)]}>{item.covered}</Text>
              </View>
              <Text style={[styles.how, { color: c.muted }]}>{plain(item.how)}</Text>
              <View style={styles.cardHeader}>
                <Text style={[styles.result, { color: r ? (r.ok ? c.ok : c.bad) : c.muted }]}>
                  {running === item.id ? 'running…' : r ? `${r.ok ? 'PASS' : 'FAIL'}: ${r.detail}` : ''}
                </Text>
                <Pressable
                  style={[styles.button, { borderColor: c.muted, opacity: item.test ? 1 : 0.4 }]}
                  disabled={!item.test || running !== null}
                  onPress={() => runOne(item)}
                >
                  <Text style={{ color: c.fg }}>{item.test ? 'Test' : 'Not implemented'}</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const lightColors = { bg: '#fff', fg: '#1a1a1a', muted: '#666', card: '#f2f2f2', ok: '#166534', bad: '#991b1b', okbg: '#dcfce7', partbg: '#fef3c7', part: '#92400e', nobg: '#fee2e2' };
const darkColors = { bg: '#111', fg: '#eee', muted: '#999', card: '#1d1d1d', ok: '#86efac', bad: '#fca5a5', okbg: '#14532d', partbg: '#78350f', part: '#fde68a', nobg: '#7f1d1d' };

function badgeStyle(covered: CoverageRow['covered'], c: typeof lightColors) {
  if (covered === 'yes') return { backgroundColor: c.okbg, color: c.ok };
  if (covered === 'partial') return { backgroundColor: c.partbg, color: c.part };
  return { backgroundColor: c.nobg, color: c.bad };
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  bar: { paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 22, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  section: { fontSize: 17, fontWeight: '700', marginTop: 18, marginBottom: 6 },
  card: { borderRadius: 8, padding: 10, marginVertical: 4, gap: 4 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  how: { fontSize: 12 },
  result: { fontSize: 12, flexShrink: 1 },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  button: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
});
