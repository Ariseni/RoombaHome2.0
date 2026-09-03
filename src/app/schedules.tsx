import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import {
  type Schedule,
  type ScheduleFrequency,
  WIRE_DAYS,
  commandsLabel,
  daysLabel,
  formatNext,
  nextOccurrence,
  timeLabel,
} from '@/protocol/models/schedules';
import { useMaps } from '@/store/maps';
import { useSchedules } from '@/store/schedules';
import { useSession } from '@/store/session';
import { Button, Card, EmptyState, Pill, Screen } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

export default function SchedulesScreen() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const { items, loading, loaded, error, load, setEnabled, create, remove } = useSchedules();
  const selected = useMaps((s) => s.selected);
  const [name, setName] = useState('');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [frequency, setFrequency] = useState<ScheduleFrequency>('WEEKLY');
  const [wholeHouse, setWholeHouse] = useState(true);

  useEffect(() => {
    if (status === 'connected' && !loaded && !loading) load().catch(() => undefined);
  }, [status, loaded, loading, load]);

  const upcoming = useMemo(
    () =>
      items
        .map((s) => ({ s, at: nextOccurrence(s) }))
        .filter((x): x is { s: Schedule; at: Date } => x.at != null)
        .sort((a, b) => a.at.getTime() - b.at.getTime()),
    [items],
  );

  const save = async () => {
    if (days.length === 0) {
      Alert.alert('Pick at least one day');
      return;
    }
    const ok = await create({
      name: name.trim() || `${daysLabel(days)} ${timeLabel(hour, minute)}`,
      days,
      hour,
      minute,
      frequency,
      wholeHouse: wholeHouse || selected.length === 0,
    });
    if (ok) setName('');
  };

  const toggleDay = (d: number) => {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <Text style={[font.small, { color: colors.accent }]} onPress={() => router.back()}>
          Back
        </Text>
        <Text style={font.title}>Schedules</Text>
        <Text style={[font.small, { marginBottom: spacing.sm }]}>
          Recurring cleans for this household. Enabling or disabling sends the full container back — omitting a
          schedule deletes it.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {upcoming[0] ? (
          <Card>
            <Text style={font.small}>Next</Text>
            <Text style={font.h2}>{upcoming[0].s.name}</Text>
            <Text style={font.small}>{formatNext(upcoming[0].at)}</Text>
          </Card>
        ) : null}

        <Card style={{ gap: spacing.sm }}>
          <Text style={font.h2}>New schedule</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Name"
            placeholderTextColor={colors.textDim}
          />
          <View style={styles.days}>
            {WIRE_DAYS.map((label, i) => (
              <Pill key={label} label={label} selected={days.includes(i)} onPress={() => toggleDay(i)} tone="info" />
            ))}
          </View>
          <View style={styles.row}>
            <Stepper label="Hour" value={hour} min={0} max={23} onChange={setHour} />
            <Stepper label="Min" value={minute} min={0} max={45} step={15} onChange={setMinute} />
          </View>
          <View style={styles.days}>
            {(['WEEKLY', 'BI_WEEKLY', 'ONCE', 'MONTHLY'] as ScheduleFrequency[]).map((f) => (
              <Pill key={f} label={FREQ[f]} selected={frequency === f} onPress={() => setFrequency(f)} />
            ))}
          </View>
          <View style={styles.row}>
            <Pill label="Whole house" selected={wholeHouse} onPress={() => setWholeHouse(true)} tone="ok" />
            <Pill
              label={selected.length ? `${selected.length} selected rooms` : 'Map selection'}
              selected={!wholeHouse}
              onPress={() => setWholeHouse(false)}
              tone="info"
            />
          </View>
          {!wholeHouse && selected.length === 0 ? (
            <Text style={font.small}>Select rooms on the Map tab first, or keep Whole house.</Text>
          ) : null}
          <Button title="Create" onPress={save} disabled={status !== 'connected'} />
        </Card>

        {items.length === 0 && loaded && !loading ? (
          <EmptyState title="No schedules" subtitle="Create one above, or add it in the official app — both share the household list." />
        ) : (
          items.map((s) => (
            <Card key={`${s.household_schedule_id}:${s.schedule_id}`} style={{ gap: spacing.sm }}>
              <View style={styles.header}>
                <View style={{ flex: 1 }}>
                  <Text style={font.h2}>{s.name}</Text>
                  <Text style={font.small}>
                    {daysLabel(s.days)} · {timeLabel(s.hour, s.minute)} · {FREQ[s.frequency]}
                  </Text>
                  <Text style={font.small}>{commandsLabel(s.commands)}</Text>
                  {s.enabled ? <Text style={font.small}>Next: {formatNext(nextOccurrence(s))}</Text> : null}
                </View>
                <Switch
                  value={s.enabled}
                  onValueChange={(v) => setEnabled(s, v)}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  thumbColor={colors.text}
                />
              </View>
              <Button
                title="Delete"
                variant="ghost"
                compact
                onPress={() =>
                  Alert.alert('Delete schedule', `Remove “${s.name}”?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => remove(s) },
                  ])
                }
              />
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const FREQ: Record<ScheduleFrequency, string> = {
  WEEKLY: 'Weekly',
  BI_WEEKLY: 'Every 2 weeks',
  ONCE: 'Once',
  MONTHLY: 'Monthly',
};

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={font.small}>{label}</Text>
      <View style={styles.row}>
        <Button title="−" variant="secondary" compact onPress={() => onChange(value - step < min ? max : value - step)} />
        <Text style={styles.stepValue}>{String(value).padStart(2, '0')}</Text>
        <Button title="+" variant="secondary" compact onPress={() => onChange(value + step > max ? min : value + step)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
  },
  stepper: { flex: 1, gap: 6 },
  stepValue: { ...font.h2, minWidth: 36, textAlign: 'center' },
  error: { color: colors.danger },
});
