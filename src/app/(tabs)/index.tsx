import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { replayStartCommand, simpleCommand, startJobLabel } from '@/protocol/commands';
import { dockStateInfo } from '@/protocol/models/dock';
import { errorText, isPickedUp, notReadyLabel } from '@/protocol/models/errors';
import { roomsSummary } from '@/protocol/models/favorites';
import { historyWhen } from '@/protocol/models/history';
import { formatNext, nextOccurrence } from '@/protocol/models/schedules';
import { type Activity, activityOf, isMissionActivity, phaseLabel } from '@/protocol/models/shadow';
import { useFavorites } from '@/store/favorites';
import { useHistory } from '@/store/history';
import { useSchedules } from '@/store/schedules';
import { useSession } from '@/store/session';
import { Button, Card, Pill, Screen, Stat } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  connected: 'ok',
  connecting: 'warn',
  authenticating: 'warn',
  reconnecting: 'warn',
  error: 'danger',
  idle: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  connected: 'Online',
  connecting: 'Connecting',
  authenticating: 'Signing in',
  reconnecting: 'Reconnecting',
  error: 'Offline',
  idle: 'Paused',
};

export default function HomeScreen() {
  const router = useRouter();
  const robot = useSession((s) => s.robot);
  const robotInfo = useSession((s) => s.robotInfo);
  const status = useSession((s) => s.status);
  const statusError = useSession((s) => s.statusError);
  const sendCommand = useSession((s) => s.sendCommand);
  const continueMission = useSession((s) => s.continueMission);
  const interrupted = useSession((s) => s.interrupted);
  const lastStart = useSession((s) => s.lastStart);
  const commandBusy = useSession((s) => s.commandBusy);
  const lastError = useSession((s) => s.lastError);
  const clearError = useSession((s) => s.clearError);
  const refreshState = useSession((s) => s.refreshState);
  const [refreshing, setRefreshing] = useState(false);
  const favorites = useFavorites((s) => s.items);
  const loadFavorites = useFavorites((s) => s.load);
  const favoritesLoaded = useFavorites((s) => s.loaded);
  const runFavorite = useFavorites((s) => s.run);
  const schedules = useSchedules((s) => s.items);
  const loadSchedules = useSchedules((s) => s.load);
  const schedulesLoaded = useSchedules((s) => s.loaded);
  const lastMission = useHistory((s) => s.items[0] ?? null);
  const loadHistory = useHistory((s) => s.load);
  const historyLoaded = useHistory((s) => s.loaded);

  useEffect(() => {
    if (status === 'connected' && !favoritesLoaded) loadFavorites().catch(() => undefined);
  }, [status, favoritesLoaded, loadFavorites]);

  useEffect(() => {
    if (status === 'connected' && !schedulesLoaded) loadSchedules().catch(() => undefined);
  }, [status, schedulesLoaded, loadSchedules]);

  useEffect(() => {
    if (status === 'connected' && !historyLoaded) loadHistory().catch(() => undefined);
  }, [status, historyLoaded, loadHistory]);

  const nextClean = useMemo(() => {
    const ranked = schedules
      .map((s) => ({ s, at: nextOccurrence(s) }))
      .filter((x): x is { s: (typeof schedules)[number]; at: Date } => x.at != null)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    return ranked[0] ?? null;
  }, [schedules]);

  const activity = activityOf(robot);
  const name = robot.name ?? robotInfo?.name ?? 'Roomba';
  const err = errorText(robot.mission.error, name);
  const notReady = robot.mission.notReady ? notReadyLabel(robot.mission.notReady) : null;
  const connected = status === 'connected';
  const replay = replayStartCommand(lastStart ?? robot.lastCommand);
  const jobLabel = startJobLabel(replay);
  const lifted = isPickedUp(robot.mission.notReady);
  const continuable = interrupted || activity === 'stuck' || activity === 'paused';
  const inOpenJob = isMissionActivity(activity) || interrupted;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshState(), loadFavorites(), loadSchedules(), loadHistory()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshState, loadFavorites, loadSchedules, loadHistory]);

  const cmd = (c: Parameters<typeof simpleCommand>[0], label: string) => () => sendCommand(simpleCommand(c), label);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={font.title}>{name}</Text>
            <Text style={font.small}>{robotInfo?.sku ? `${robotInfo.sku} · ` : ''}{phaseLabel(robot)}</Text>
          </View>
          <Pill label={STATUS_LABEL[status] ?? status} tone={STATUS_TONE[status] ?? 'neutral'} />
        </View>

        {statusError && !connected ? (
          <Card style={styles.banner}>
            <Ionicons name="cloud-offline" size={18} color={colors.warning} />
            <Text style={[font.small, { flex: 1 }]}>{statusError}</Text>
          </Card>
        ) : null}
        {lastError ? (
          <Card style={[styles.banner, { borderColor: colors.danger }]}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={[font.small, { flex: 1 }]}>{lastError}</Text>
            <Text style={[font.small, { color: colors.accent }]} onPress={clearError}>
              Dismiss
            </Text>
          </Card>
        ) : null}

        <Card>
          <View style={styles.statusRow}>
            <ActivityBadge activity={activity} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusText}>{phaseLabel(robot)}</Text>
              <Text style={font.small}>
                {robot.mission.cycle && robot.mission.cycle !== 'none' ? `${robot.mission.cycle} · ` : ''}
                {robot.updatedAt ? `updated ${timeAgo(robot.updatedAt)}` : 'waiting for robot…'}
              </Text>
            </View>
          </View>

          {err ? (
            <View style={styles.errorBox}>
              <Text style={[font.body, { color: colors.danger, fontWeight: '600' }]}>{err.title}</Text>
              <Text style={[font.small, { marginTop: 4 }]}>{err.content}</Text>
            </View>
          ) : null}
          {!err && notReady && activity !== 'cleaning' ? (
            <View style={styles.errorBox}>
              <Text style={[font.small, { color: colors.warning }]}>{notReady}</Text>
            </View>
          ) : null}
          {activity === 'stuck' || interrupted || lifted ? (
            <Text style={[font.small, { marginTop: spacing.md }]}>
              {lifted
                ? 'Set it on the floor. It can look around, then Continue picks up the same job — it will not start over.'
                : jobLabel
                  ? `Continue ${jobLabel}. It may look around first, then keep going from here.`
                  : 'Continue the same job. It may look around first, then keep going from here.'}
            </Text>
          ) : null}

          <View style={styles.stats}>
            <Stat
              label="Battery"
              value={robot.batPct != null ? `${robot.batPct}%` : '—'}
              tone={robot.batPct != null && robot.batPct < 20 ? 'danger' : robot.batPct != null && robot.batPct < 40 ? 'warn' : 'ok'}
            />
            {inOpenJob ? (
              <>
                <Stat label="Minutes" value={robot.mission.missionMinutes != null ? String(robot.mission.missionMinutes) : '—'} />
                <Stat label="m² cleaned" value={robot.mission.sqft != null ? sqftToM2(robot.mission.sqft) : '—'} />
              </>
            ) : (
              <>
                <Stat label="Bin" value={robot.binPresent === false ? 'Missing' : robot.binFull ? 'Full' : robot.binPresent ? 'OK' : '—'} tone={robot.binPresent === false || robot.binFull ? 'warn' : undefined} />
                <Stat
                  label="Tank"
                  value={robot.tankPresent === false ? 'Missing' : robot.tankLvl != null ? `${robot.tankLvl}%` : robot.tankPresent ? 'OK' : '—'}
                  tone={robot.tankPresent === false ? 'warn' : undefined}
                />
              </>
            )}
          </View>
        </Card>

        <Controls
          activity={activity}
          continuable={continuable}
          inMission={inOpenJob}
          continueLabel="Continue"
          disabled={!connected}
          busy={commandBusy}
          onClean={() => router.push('/clean')}
          onRooms={() => router.push('/(tabs)/map')}
          onPause={cmd('pause', 'pause')}
          onResume={() => continueMission()}
          onStop={cmd('stop', 'stop')}
          onDock={cmd('dock', 'dock')}
          onFind={cmd('find', 'find')}
        />

        <Card>
          <View style={styles.dockRow}>
            <Ionicons name="time" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={font.body}>Last clean</Text>
              <Text style={font.small}>
                {lastMission ? `${historyWhen(lastMission)} · ${lastMission.doneLabel}` : 'No history yet'}
              </Text>
            </View>
            <Text style={[font.small, { color: colors.accent }]} onPress={() => router.push('/history')}>
              All
            </Text>
          </View>
        </Card>

        <Card>
          <View style={styles.dockRow}>
            <Ionicons name="calendar" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={font.body}>Schedule</Text>
              <Text style={font.small}>
                {nextClean ? `${nextClean.s.name} · ${formatNext(nextClean.at)}` : 'No upcoming clean'}
              </Text>
            </View>
            <Text style={[font.small, { color: colors.accent }]} onPress={() => router.push('/schedules')}>
              Edit
            </Text>
          </View>
        </Card>

        {favorites.length > 0 ? (
          <Card style={{ gap: spacing.sm }}>
            <View style={styles.dockRow}>
              <Ionicons name="star" size={18} color={colors.accent} />
              <Text style={[font.body, { flex: 1 }]}>Favorites</Text>
              <Text style={[font.small, { color: colors.accent }]} onPress={() => router.push('/(tabs)/favorites')}>
                All
              </Text>
            </View>
            {favorites.slice(0, 4).map((fav) => (
              <View key={fav.favorite_id} style={styles.favRow}>
                <View style={{ flex: 1 }}>
                  <Text style={font.body}>{fav.name}</Text>
                  <Text style={font.small} numberOfLines={1}>
                    {roomsSummary(fav)}
                  </Text>
                </View>
                <Button
                  title="Run"
                  compact
                  disabled={!connected}
                  loading={commandBusy === `fav:${fav.name}`}
                  onPress={() => runFavorite(fav)}
                />
              </View>
            ))}
          </Card>
        ) : null}

        {robot.dock ? (
          <Card>
            <View style={styles.dockRow}>
              <Ionicons name="water" size={18} color={colors.mop} />
              <Text style={[font.body, { flex: 1 }]}>AutoWash dock</Text>
              <Text style={[font.small, { color: colors.accent }]} onPress={() => router.push('/(tabs)/dock')}>
                Details
              </Text>
            </View>
            <View style={[styles.stats, { marginTop: spacing.md }]}>
              <DockStat label="Bin" code={robot.dock.state} />
              <DockStat label="Wash" code={robot.dock.pwState} />
              <DockStat label="Dry" code={robot.dock.pdState} />
              <DockStat label="Refill" code={robot.dock.frState} />
            </View>
          </Card>
        ) : null}

        {robot.detectedPad ? (
          <Text style={[font.small, { textAlign: 'center' }]}>Pad: {robot.detectedPad}</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function DockStat({ label, code }: { label: string; code: number | null }) {
  const info = dockStateInfo(code);
  const tone = info?.severity === 'error' ? 'danger' : info?.severity === 'warn' ? 'warn' : info?.severity === 'busy' ? undefined : 'ok';
  return <Stat label={label} value={info ? shorten(info.label) : '—'} tone={tone} />;
}

function shorten(s: string): string {
  return s.length > 12 ? s.slice(0, 11) + '…' : s;
}

function Controls(p: {
  activity: Activity;
  continuable: boolean;
  inMission: boolean;
  continueLabel: string;
  disabled: boolean;
  busy: string | null;
  onClean: () => void;
  onRooms: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDock: () => void;
  onFind: () => void;
}) {
  const b = (label: string) => p.busy === label;
  const primary =
    p.activity === 'cleaning' ? (
      <Button title="Pause" onPress={p.onPause} loading={b('pause')} disabled={p.disabled} icon={<Ionicons name="pause" size={18} color={colors.bg} />} style={{ flex: 1 }} />
    ) : p.continuable ? (
      <Button title={p.continueLabel} onPress={p.onResume} loading={b('resume')} disabled={p.disabled} icon={<Ionicons name="play" size={18} color={colors.bg} />} style={{ flex: 1 }} />
    ) : (
      <Button title="Clean everything" onPress={p.onClean} disabled={p.disabled} icon={<Ionicons name="play" size={18} color={colors.bg} />} style={{ flex: 1 }} />
    );

  const inMission = p.inMission;

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.controlsRow}>
        {primary}
        {inMission ? (
          <Button title="Dock" variant="secondary" onPress={p.onDock} loading={b('dock')} disabled={p.disabled} icon={<Ionicons name="home" size={18} color={colors.text} />} />
        ) : (
          <Button title="Rooms" variant="secondary" onPress={p.onRooms} disabled={p.disabled} icon={<Ionicons name="grid" size={18} color={colors.text} />} />
        )}
      </View>
      <View style={styles.controlsRow}>
        {inMission ? (
          <Button title="Stop" variant="ghost" compact onPress={p.onStop} loading={b('stop')} disabled={p.disabled} style={{ flex: 1 }} />
        ) : (
          <Button title="Send to dock" variant="ghost" compact onPress={p.onDock} loading={b('dock')} disabled={p.disabled} style={{ flex: 1 }} />
        )}
        <Button title="Find robot" variant="ghost" compact onPress={p.onFind} loading={b('find')} disabled={p.disabled} style={{ flex: 1 }} icon={<Ionicons name="volume-high" size={16} color={colors.text} />} />
      </View>
    </View>
  );
}

function ActivityBadge({ activity }: { activity: Activity }) {
  const map: Record<Activity, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
    idle: { icon: 'checkmark-circle', color: colors.success },
    charging: { icon: 'battery-charging', color: colors.success },
    cleaning: { icon: 'sparkles', color: colors.accent },
    paused: { icon: 'pause-circle', color: colors.warning },
    returning: { icon: 'home', color: colors.accent },
    stuck: { icon: 'warning', color: colors.danger },
    error: { icon: 'alert-circle', color: colors.danger },
    evacuating: { icon: 'trash', color: colors.accent },
    washing: { icon: 'water', color: colors.mop },
    drying: { icon: 'sunny', color: colors.warning },
    refilling: { icon: 'water', color: colors.mop },
    unknown: { icon: 'help-circle', color: colors.textDim },
  };
  const { icon, color } = map[activity];
  return (
    <View style={[styles.badge, { backgroundColor: `${color}22` }]}>
      <Ionicons name={icon} size={28} color={color} />
    </View>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

function sqftToM2(sqft: number): string {
  return (sqft * 0.0929).toFixed(0);
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderColor: colors.warning },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusText: { fontSize: 20, fontWeight: '600', color: colors.text },
  badge: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  errorBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bg },
  stats: { flexDirection: 'row', marginTop: spacing.lg, gap: spacing.sm },
  controlsRow: { flexDirection: 'row', gap: spacing.sm },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  favRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
