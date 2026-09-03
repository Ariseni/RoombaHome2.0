import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { type CleanMode, type CleanOptions, type SuctionLevel, type WetnessLevel, buildParams, startCommand, supportedCleanModes } from '@/protocol/commands';
import { useSession } from '@/store/session';
import { Button, Card, Screen, Segmented } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

export default function CleanModal() {
  const router = useRouter();
  const robot = useSession((s) => s.robot);
  const robotInfo = useSession((s) => s.robotInfo);
  const sendCommand = useSession((s) => s.sendCommand);
  const commandBusy = useSession((s) => s.commandBusy);
  const cap = robotInfo?.cap ?? robot.cap;
  const modes = useMemo(() => supportedCleanModes(cap.oMode), [cap.oMode]);
  const suctionCount = cap.suctionLvl ?? 3;
  const wetnessCount = cap.ppWetLvl ?? 3;

  const [mode, setMode] = useState<CleanMode>(modes[0] ?? 'vacuum');
  const [suction, setSuction] = useState<SuctionLevel>(2);
  const [wetness, setWetness] = useState<WetnessLevel>('moderate');
  const [passes, setPasses] = useState<1 | 2>(1);

  const mopping = mode !== 'vacuum';
  const opts: CleanOptions = {
    mode,
    suction: mopping && mode === 'mop' ? undefined : suction,
    wetness: mopping ? wetness : undefined,
    passes,
  };

  const start = async () => {
    const ok = await sendCommand(startCommand(buildParams(opts)), 'start');
    if (ok) router.back();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={font.title}>Start cleaning</Text>
        <Text style={[font.small, { marginBottom: spacing.md }]}>Whole house. Pick rooms on the Map tab instead.</Text>

        <Card>
          <Text style={styles.label}>Mode</Text>
          <View style={styles.grid}>
            {modes.map((m) => (
              <ModeChip key={m} label={MODE_LABEL[m]} selected={mode === m} onPress={() => setMode(m)} />
            ))}
          </View>
        </Card>

        {mode !== 'mop' && suctionCount > 1 ? (
          <Card>
            <Text style={styles.label}>Suction</Text>
            <Segmented
              options={SUCTION.slice(0, suctionCount).map((s, i) => ({ value: String(i + 1) as `${SuctionLevel}`, label: s }))}
              value={String(suction) as `${SuctionLevel}`}
              onChange={(v) => setSuction(Number(v) as SuctionLevel)}
            />
          </Card>
        ) : null}

        {mopping && wetnessCount > 0 ? (
          <Card>
            <Text style={styles.label}>Pad wetness</Text>
            <Segmented
              options={WETNESS.slice(0, wetnessCount).map((w) => ({ value: w.value, label: w.label }))}
              value={wetness}
              onChange={setWetness}
            />
          </Card>
        ) : null}

        <Card>
          <Text style={styles.label}>Passes</Text>
          <Segmented
            options={[
              { value: '1', label: 'One' },
              { value: '2', label: 'Two' },
            ]}
            value={String(passes)}
            onChange={(v) => setPasses(Number(v) as 1 | 2)}
          />
        </Card>

        <Button title="Start" onPress={start} loading={commandBusy === 'start'} />
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const MODE_LABEL: Record<CleanMode, string> = {
  vacuum: 'Vacuum',
  mop: 'Mop',
  vacuum_and_mop: 'Vac + mop',
  vacuum_then_mop: 'Vac then mop',
};

const SUCTION = ['Low', 'Med', 'High', 'Turbo'];
const WETNESS: { value: WetnessLevel; label: string }[] = [
  { value: 'damp', label: 'Damp' },
  { value: 'moderate', label: 'Normal' },
  { value: 'wet', label: 'Wet' },
];

function ModeChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: selected ? colors.accent : colors.surfaceAlt, color: selected ? colors.bg : colors.text },
      ]}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  label: { ...font.small, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.pill, overflow: 'hidden', fontWeight: '600' },
});
