import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { MapCanvas } from '@/features/map/MapCanvas';
import { type CleanOptions, buildParams, regionCommand } from '@/protocol/commands';
import { roomToArea, useMaps, zoneToArea } from '@/store/maps';
import { useSession } from '@/store/session';
import { Button, Card, EmptyState, Pill, Screen } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

export default function MapScreen() {
  const { width, height } = useWindowDimensions();
  const status = useSession((s) => s.status);
  const sendCommand = useSession((s) => s.sendCommand);
  const commandBusy = useSession((s) => s.commandBusy);
  const liveMap = useSession((s) => s.liveMap);
  const startLiveMap = useSession((s) => s.startLiveMap);
  const stopLiveMap = useSession((s) => s.stopLiveMap);
  const { loading, error, active, selected, load, toggle, clearSelection, selectedRegions } = useMaps();

  useEffect(() => {
    if (status === 'connected' && !active && !loading) load().catch(() => undefined);
  }, [status, active, loading, load]);

  useEffect(() => {
    if (status === 'connected') startLiveMap().catch(() => undefined);
    return () => stopLiveMap();
  }, [status, startLiveMap, stopLiveMap]);

  const canvasH = Math.max(280, height - 380);

  const cleanSelected = async () => {
    if (!active) return;
    const regions = selectedRegions();
    if (regions.length === 0) return;
    const opts: CleanOptions = { mode: 'vacuum_and_mop' };
    await sendCommand(
      regionCommand({
        blid: useSession.getState().robotInfo?.blid ?? useSession.getState().selectedBlid ?? '',
        p2mapId: active.p2mapId,
        regions,
        params: buildParams(opts),
      }),
      'start',
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Text style={font.title}>{active?.name ?? 'Map'}</Text>
          <Text style={font.small}>
            {active ? `${active.rooms.length} rooms` : loading ? 'Loading…' : 'No map yet'}
            {liveMap.active ? ' · live' : ''}
          </Text>
        </View>
        <Pill label={loading ? 'Refreshing' : 'Refresh'} onPress={() => load(true)} />
      </View>

      {error && !active ? (
        <EmptyState title="Could not load map" subtitle={error} action={<Button title="Retry" onPress={() => load(true)} />} />
      ) : !active && loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[font.small, { marginTop: spacing.md }]}>Downloading map…</Text>
        </View>
      ) : !active ? (
        <EmptyState title="No map yet" subtitle="The robot needs to finish a mapping run first. You can still start a whole-house clean from Home." />
      ) : (
        <>
          <View style={[styles.canvas, { height: canvasH }]}>
            <MapCanvas
              model={active}
              selected={selected}
              onToggle={toggle}
              liveSamples={liveMap.samples}
              width={width}
              height={canvasH}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {active.rooms.map((r) => (
              <Pill
                key={`r-${r.id}`}
                label={r.name ?? `Room ${r.id}`}
                selected={selected.some((s) => s.id === r.id && s.type === 'rid')}
                onPress={() => toggle(roomToArea(r))}
                tone="info"
              />
            ))}
            {active.zones.map((z) => (
              <Pill
                key={`z-${z.id}`}
                label={z.name ?? `Zone ${z.id}`}
                selected={selected.some((s) => s.id === z.id && s.type === 'zid')}
                onPress={() => toggle(zoneToArea(z))}
                tone="warn"
              />
            ))}
          </ScrollView>
          <Card style={styles.bar}>
            <Text style={[font.small, { flex: 1 }]}>
              {selected.length === 0 ? 'Tap rooms to clean them' : `${selected.length} selected`}
            </Text>
            {selected.length > 0 ? <Button title="Clear" variant="ghost" compact onPress={clearSelection} /> : null}
            <Button
              title={selected.length ? 'Clean selected' : 'Pick rooms'}
              compact
              disabled={selected.length === 0 || status !== 'connected'}
              loading={commandBusy === 'start'}
              onPress={cleanSelected}
            />
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: spacing.lg, paddingBottom: spacing.sm },
  canvas: { backgroundColor: colors.surface, overflow: 'hidden' },
  chips: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  bar: { margin: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  unused: { borderRadius: radius.md },
});
