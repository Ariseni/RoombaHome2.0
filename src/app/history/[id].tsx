import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { MapCanvas } from '@/features/map/MapCanvas';
import { errorText } from '@/protocol/models/errors';
import { highlightCoverage, historyAreaM2, historyRooms, historyWhen } from '@/protocol/models/history';
import type { MapModel } from '@/protocol/maps/bundle';
import { useHistory } from '@/store/history';
import { useMaps } from '@/store/maps';
import { useSession } from '@/store/session';
import { Card, EmptyState, Screen, Stat } from '@/ui/components';
import { colors, font, spacing } from '@/ui/theme';

export default function HistoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const robotName = useSession((s) => s.robot.name ?? s.robotInfo?.name ?? 'Roomba');
  const items = useHistory((s) => s.items);
  const load = useHistory((s) => s.load);
  const loaded = useHistory((s) => s.loaded);
  const loading = useHistory((s) => s.loading);
  const active = useMaps((s) => s.active);
  const loadMaps = useMaps((s) => s.load);
  const loadModel = useMaps((s) => s.loadModel);
  const [model, setModel] = useState<MapModel | null>(null);

  const key = id ? decodeURIComponent(id) : '';
  const entry = items.find((e) => e.key === key) ?? null;

  useEffect(() => {
    if (!loaded) load().catch(() => undefined);
  }, [loaded, load]);

  useEffect(() => {
    if (!active) loadMaps().catch(() => undefined);
  }, [active, loadMaps]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const p2 = entry?.command?.p2mapId;
      const ver = entry?.command?.mapVersionId;
      if (p2 && ver) {
        const hist = await loadModel(p2, ver);
        if (!cancelled && hist) {
          setModel(hist);
          return;
        }
      }
      if (!cancelled) setModel(active);
    };
    run().catch(() => {
      if (!cancelled) setModel(active);
    });
    return () => {
      cancelled = true;
    };
  }, [entry, active, loadModel]);

  const names = useMemo(() => Object.fromEntries((model?.rooms ?? []).map((r) => [r.id, r.name ?? r.id])), [model]);
  const highlights = entry ? highlightCoverage(entry) : [];
  const canvasH = Math.max(260, height - 420);
  const err = errorText(entry?.errorCode, robotName);

  if (!entry) {
    return (
      <Screen>
        <EmptyState
          title={loading || !loaded ? 'Loading mission…' : 'Mission not found'}
          subtitle={loading || !loaded ? undefined : 'Go back and pick another run.'}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[font.small, { color: colors.accent }]} onPress={() => router.back()}>
          Back
        </Text>
        <Text style={font.title}>{historyWhen(entry)}</Text>
        <Text style={font.small}>{entry.doneLabel} · {historyRooms(entry, names)}</Text>

        <View style={styles.stats}>
          <Stat label="Cleaning" value={entry.runM != null ? `${entry.runM} min` : '—'} />
          <Stat label="Elapsed" value={entry.durationM != null ? `${entry.durationM} min` : '—'} />
          <Stat label="Area" value={historyAreaM2(entry.sqft)} />
        </View>
        {entry.pauseM || entry.chargeM || entry.evacs ? (
          <Text style={font.small}>
            {entry.pauseM ? `Paused ${entry.pauseM} min` : ''}
            {entry.chargeM ? `${entry.pauseM ? ' · ' : ''}Charged ${entry.chargeM} min` : ''}
            {entry.evacs ? `${entry.pauseM || entry.chargeM ? ' · ' : ''}Emptied ${entry.evacs}×` : ''}
          </Text>
        ) : null}
        {err ? (
          <Card>
            <Text style={[font.body, { color: colors.danger }]}>{err.title}</Text>
            <Text style={font.small}>{err.content}</Text>
          </Card>
        ) : null}

        {model ? (
          <View style={[styles.canvas, { height: canvasH }]}>
            <MapCanvas
              model={model}
              selected={[]}
              highlights={highlights}
              showMissionLayers
              width={width}
              height={canvasH}
            />
          </View>
        ) : (
          <Text style={font.small}>Loading map…</Text>
        )}

        {entry.visits.length > 0 ? (
          <Card style={{ gap: spacing.sm }}>
            <Text style={font.h2}>Rooms</Text>
            {entry.visits.map((v, i) => (
              <View key={`${v.region_id}-${i}`} style={styles.visit}>
                <Text style={[font.body, { flex: 1 }]}>{names[v.region_id] ?? v.region_id}</Text>
                <Text style={font.small}>
                  {v.coverage != null ? `${Math.round(v.coverage * 100)}%` : v.statusLabel ?? '—'}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  stats: { flexDirection: 'row', gap: spacing.sm },
  canvas: { backgroundColor: colors.surface, overflow: 'hidden', marginHorizontal: -spacing.lg },
  visit: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
