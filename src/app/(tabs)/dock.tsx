import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { DOCK_COMMANDS, simpleCommand } from '@/protocol/commands';
import { dockStateInfo, isDockBusy } from '@/protocol/models/dock';
import { useSession } from '@/store/session';
import { Button, Card, Screen, Stat } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

export default function DockScreen() {
  const robot = useSession((s) => s.robot);
  const status = useSession((s) => s.status);
  const sendCommand = useSession((s) => s.sendCommand);
  const commandBusy = useSession((s) => s.commandBusy);
  const dockReports = useSession((s) => s.dockReports);
  const dock = robot.dock;
  const connected = status === 'connected';

  const act = (cmd: (typeof DOCK_COMMANDS)[keyof typeof DOCK_COMMANDS], label: string) => () =>
    sendCommand(simpleCommand(cmd), label);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={font.title}>AutoWash dock</Text>
        <Text style={[font.small, { marginBottom: spacing.md }]}>
          Pad: {robot.detectedPad ?? '—'}
          {robot.tankLvl != null ? ` · robot tank ${robot.tankLvl}%` : ''}
        </Text>

        <Card>
          <View style={styles.stats}>
            <Stat label="Bin empty" value={labelOf(dock?.state)} tone={toneOf(dock?.state)} />
            <Stat label="Pad wash" value={labelOf(dock?.pwState)} tone={toneOf(dock?.pwState)} />
            <Stat label="Pad dry" value={labelOf(dock?.pdState)} tone={toneOf(dock?.pdState)} />
            <Stat label="Refill" value={labelOf(dock?.frState)} tone={toneOf(dock?.frState)} />
          </View>
        </Card>

        <Card style={{ gap: spacing.sm }}>
          <Text style={font.h2}>Actions</Text>
          <Button
            title="Empty bin"
            onPress={act(DOCK_COMMANDS.emptyBin, 'evac')}
            loading={commandBusy === 'evac'}
            disabled={!connected || isDockBusy(dock?.state)}
          />
          <Button
            title="Wash pads"
            variant="secondary"
            onPress={act(DOCK_COMMANDS.washPads, 'washpad')}
            loading={commandBusy === 'washpad'}
            disabled={!connected || isDockBusy(dock?.pwState)}
          />
          <Button
            title="Dry pads"
            variant="secondary"
            onPress={act(DOCK_COMMANDS.dryPads, 'drypad')}
            loading={commandBusy === 'drypad'}
            disabled={!connected || isDockBusy(dock?.pdState)}
          />
          <Button
            title="Refill tank"
            variant="secondary"
            onPress={act(DOCK_COMMANDS.refillTank, 'flrefill')}
            loading={commandBusy === 'flrefill'}
            disabled={!connected || isDockBusy(dock?.frState)}
          />
          {isDockBusy(dock?.pdState) ? (
            <Button title="Stop drying" variant="ghost" compact onPress={act(DOCK_COMMANDS.stopDryPads, 'stoppaddry')} />
          ) : null}
          {isDockBusy(dock?.state) ? (
            <Button title="Stop emptying" variant="ghost" compact onPress={act(DOCK_COMMANDS.stopEmptyBin, 'stopevac')} />
          ) : null}
        </Card>

        <Card>
          <Text style={font.h2}>Recent dock reports</Text>
          {dockReports.length === 0 ? (
            <Text style={[font.small, { marginTop: spacing.sm }]}>None yet. Reports appear while the dock is working.</Text>
          ) : (
            dockReports.slice(0, 8).map((r, i) => (
              <View key={`${r.at}-${i}`} style={styles.report}>
                <Text style={styles.kind}>{r.kind}</Text>
                <Text style={font.mono}>{JSON.stringify(r.payload).slice(0, 220)}</Text>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function labelOf(code: number | null | undefined): string {
  return dockStateInfo(code)?.label ?? '—';
}

function toneOf(code: number | null | undefined): 'ok' | 'warn' | 'danger' | undefined {
  const s = dockStateInfo(code)?.severity;
  if (s === 'error') return 'danger';
  if (s === 'warn') return 'warn';
  if (s === 'ok') return 'ok';
  return undefined;
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  report: { marginTop: spacing.md, padding: spacing.sm, backgroundColor: colors.bg, borderRadius: radius.sm },
  kind: { ...font.small, color: colors.accent, marginBottom: 4, textTransform: 'uppercase' },
});
