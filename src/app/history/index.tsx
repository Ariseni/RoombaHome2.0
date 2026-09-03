import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorText } from '@/protocol/models/errors';
import { historyAreaM2, historyRooms, historyWhen } from '@/protocol/models/history';
import { useHistory } from '@/store/history';
import { useMaps } from '@/store/maps';
import { useSession } from '@/store/session';
import { Button, Card, EmptyState, Screen } from '@/ui/components';
import { colors, font, spacing } from '@/ui/theme';

export default function HistoryListScreen() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const robotName = useSession((s) => s.robot.name ?? s.robotInfo?.name ?? 'Roomba');
  const { items, loading, loaded, loadingMore, error, load, loadMore } = useHistory();
  const names = Object.fromEntries((useMaps((s) => s.active?.rooms) ?? []).map((r) => [r.id, r.name ?? r.id]));

  useEffect(() => {
    if (status === 'connected' && !loaded && !loading) load().catch(() => undefined);
  }, [status, loaded, loading, load]);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <Text style={[font.small, { color: colors.accent }]} onPress={() => router.back()}>
          Back
        </Text>
        <Text style={font.title}>History</Text>
        <Text style={[font.small, { marginBottom: spacing.sm }]}>
          Past missions. Open one to see which rooms ran and any coverage the map bundle still has.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {items.length === 0 && loaded && !loading ? (
          <EmptyState title="No missions yet" subtitle="Finished cleans show up here. Quickly canceled runs are hidden, matching the official app." />
        ) : (
          items.map((e) => {
            const err = errorText(e.errorCode, robotName);
            return (
              <Card key={e.key} style={{ gap: 4 }}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={font.h2}>{historyWhen(e)}</Text>
                    <Text style={font.small}>{historyRooms(e, names)}</Text>
                  </View>
                  <Text style={[font.small, { color: e.done === 'ok' ? colors.success : colors.warning }]}>{e.doneLabel}</Text>
                </View>
                <Text style={font.small}>
                  {e.runM != null ? `${e.runM} min cleaning` : e.durationM != null ? `${e.durationM} min` : '—'}
                  {e.sqft != null ? ` · ${historyAreaM2(e.sqft)}` : ''}
                  {e.nMission != null ? ` · #${e.nMission}` : ''}
                </Text>
                {err ? <Text style={[font.small, { color: colors.danger }]}>{err.title}</Text> : null}
                <Button title="Coverage" variant="secondary" compact onPress={() => router.push(`/history/${encodeURIComponent(e.key)}`)} />
              </Card>
            );
          })
        )}
        {items.length > 0 ? (
          <Button title={loadingMore ? 'Loading…' : 'Older missions'} variant="ghost" onPress={loadMore} disabled={loadingMore} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  error: { color: colors.danger },
});
