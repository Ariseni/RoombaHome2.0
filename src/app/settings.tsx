import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { simpleCommand } from '@/protocol/commands';
import { clockLabel, evacFreqOptions, minutesToClock, WASH_RETURN } from '@/protocol/models/settings';
import { useSession } from '@/store/session';
import { useSettings } from '@/store/settings';
import { Button, Card, Pill, Screen } from '@/ui/components';
import { colors, font, spacing } from '@/ui/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const sendCommand = useSession((s) => s.sendCommand);
  const commandBusy = useSession((s) => s.commandBusy);
  const cap = useSession((s) => s.robotInfo?.cap ?? s.robot.cap);
  const { settings, dnd, loading, loaded, saving, error, load, set, setQuietHours } = useSettings();

  const start = minutesToClock(dnd?.dailyStart) ?? { hour: 22, minute: 0 };
  const end = minutesToClock(dnd?.dailyEnd) ?? { hour: 7, minute: 0 };
  const [qh, setQh] = useState(start);
  const [qe, setQe] = useState(end);

  useEffect(() => {
    if (status === 'connected' && !loaded && !loading) load().catch(() => undefined);
  }, [status, loaded, loading, load]);

  useEffect(() => {
    const s = minutesToClock(dnd?.dailyStart);
    const e = minutesToClock(dnd?.dailyEnd);
    if (s) setQh(s);
    if (e) setQe(e);
  }, [dnd?.dailyStart, dnd?.dailyEnd]);

  const s = settings;
  const evacOpts = evacFreqOptions(cap.autoevac);
  const volMax = s?.volume != null && s.volume > 10 ? 100 : 10;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      >
        <Text style={[font.small, { color: colors.accent }]} onPress={() => router.back()}>
          Back
        </Text>
        <Text style={font.title}>Settings</Text>
        <Text style={[font.small, { marginBottom: spacing.sm }]}>
          Writes one key at a time to `rw-settings`. Dotted names like audio.volume are the real key — not a nested path.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {s?.childLock != null ? (
          <Toggle title="Child lock" hint="Buttons on the robot do nothing until this is off." value={s.childLock} saving={saving === 'childLock'} onChange={(v) => set('childLock', v)} />
        ) : null}

        {s?.volume != null ? (
          <Card style={{ gap: spacing.sm }}>
            <Text style={font.h2}>Volume</Text>
            <Stepper
              label={`${s.volume}`}
              value={s.volume}
              min={0}
              max={volMax}
              onChange={(v) => set('audio.volume', v)}
            />
          </Card>
        ) : null}

        {(s?.padWashReturn != null || s?.padWashArea != null || s?.padWashAllowed != null) ? (
          <Card style={{ gap: spacing.sm }}>
            <Text style={font.h2}>Pad wash</Text>
            {s.padWashAllowed != null ? (
              <ToggleRow label="Wash pads" value={s.padWashAllowed} saving={saving === 'padWashAllowed'} onChange={(v) => set('padWashAllowed', v)} />
            ) : null}
            {s.padDryAllowed != null ? (
              <ToggleRow label="Dry pads" value={s.padDryAllowed} saving={saving === 'padDryAllowed'} onChange={(v) => set('padDryAllowed', v)} />
            ) : null}
            {s.padWashReturn != null ? (
              <View style={styles.wrap}>
                {WASH_RETURN.map((o) => (
                  <Pill key={o.value} label={o.label} selected={s.padWashReturn === o.value} onPress={() => set('pwReturn', o.value)} />
                ))}
              </View>
            ) : null}
            {s.padWashReturn === 2 && s.padWashArea != null ? (
              <Stepper label={`Area (${Math.round(s.padWashArea * 10 * 0.0929)} m²)`} value={s.padWashArea} min={5} max={50} step={5} onChange={(v) => set('pwAreaInterval', v)} />
            ) : null}
            {s.padWashReturn === 1 && s.padWashTime != null ? (
              <Stepper label={`Minutes (${s.padWashTime})`} value={s.padWashTime} min={5} max={60} step={5} onChange={(v) => set('pwTimeInterval', v)} />
            ) : null}
            {s.padDryDuration != null ? (
              <Stepper label={`Dry duration ${s.padDryDuration}`} value={s.padDryDuration} min={30} max={180} step={15} onChange={(v) => set('padDryDur', v)} />
            ) : null}
          </Card>
        ) : null}

        {s && (s.ecoCharge != null || s.carpetBoost != null || s.twoPass != null || s.vacHigh != null || s.noAutoPasses != null || s.evacAllowed != null) ? (
          <Card style={{ gap: spacing.sm }}>
            <Text style={font.h2}>Cleaning</Text>
            {s.ecoCharge != null ? <ToggleRow label="Eco charge" value={s.ecoCharge} saving={saving === 'ecoCharge'} onChange={(v) => set('ecoCharge', v)} /> : null}
            {s.carpetBoost != null ? <ToggleRow label="Carpet boost" value={s.carpetBoost} saving={saving === 'carpetBoost'} onChange={(v) => set('carpetBoost', v)} /> : null}
            {s.twoPass != null ? <ToggleRow label="Two passes" value={s.twoPass} saving={saving === 'twoPass'} onChange={(v) => set('twoPass', v)} /> : null}
            {s.vacHigh != null ? <ToggleRow label="High suction" value={s.vacHigh} saving={saving === 'vacHigh'} onChange={(v) => set('vacHigh', v)} /> : null}
            {s.noAutoPasses != null ? <ToggleRow label="No auto passes" value={s.noAutoPasses} saving={saving === 'noAutoPasses'} onChange={(v) => set('noAutoPasses', v)} /> : null}
            {s.evacAllowed != null ? <ToggleRow label="Empty bin" value={s.evacAllowed} saving={saving === 'evacAllowed'} onChange={(v) => set('evacAllowed', v)} /> : null}
            {evacOpts.length > 0 && s.autoevacFreq != null ? (
              <View style={styles.wrap}>
                {evacOpts.map((o) => (
                  <Pill key={o.value} label={o.label} selected={s.autoevacFreq === o.value} onPress={() => set('autoevacFreq', o.value)} />
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}

        <Card style={{ gap: spacing.sm }}>
          <Text style={font.h2}>Quiet hours</Text>
          <Text style={font.small}>
            Household-wide. Daily window is minutes since midnight. Current: {clockLabel(dnd?.dailyStart)}–{clockLabel(dnd?.dailyEnd)}.
          </Text>
          <View style={styles.row}>
            <Stepper label="Start h" value={qh.hour} min={0} max={23} onChange={(hour) => setQh((p) => ({ ...p, hour }))} />
            <Stepper label="Start m" value={qh.minute} min={0} max={45} step={15} onChange={(minute) => setQh((p) => ({ ...p, minute }))} />
          </View>
          <View style={styles.row}>
            <Stepper label="End h" value={qe.hour} min={0} max={23} onChange={(hour) => setQe((p) => ({ ...p, hour }))} />
            <Stepper label="End m" value={qe.minute} min={0} max={45} step={15} onChange={(minute) => setQe((p) => ({ ...p, minute }))} />
          </View>
          <Button
            title="Save quiet hours"
            onPress={() => setQuietHours(qh.hour, qh.minute, qe.hour, qe.minute)}
            loading={saving === 'dnd'}
            disabled={status !== 'connected'}
          />
          <View style={styles.row}>
            <Button
              title="Quiet now"
              variant="secondary"
              compact
              onPress={() => sendCommand(simpleCommand('start_dnd'), 'start_dnd')}
              loading={commandBusy === 'start_dnd'}
              disabled={status !== 'connected'}
              style={{ flex: 1 }}
            />
            <Button
              title="End quiet"
              variant="ghost"
              compact
              onPress={() => sendCommand(simpleCommand('stop_dnd'), 'stop_dnd')}
              loading={commandBusy === 'stop_dnd'}
              disabled={status !== 'connected'}
              style={{ flex: 1 }}
            />
          </View>
        </Card>

        {s?.name || s?.timezone ? (
          <Text style={font.small}>
            {s.name ? `${s.name} · ` : ''}
            {s.timezone ?? ''}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Toggle({ title, hint, value, saving, onChange }: { title: string; hint?: string; value: boolean; saving: boolean; onChange: (v: boolean) => void }) {
  return (
    <Card>
      <View style={styles.toggleHead}>
        <View style={{ flex: 1 }}>
          <Text style={font.h2}>{title}</Text>
          {hint ? <Text style={font.small}>{hint}</Text> : null}
        </View>
        <Switch value={value} onValueChange={onChange} disabled={saving} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.text} />
      </View>
    </Card>
  );
}

function ToggleRow({ label, value, saving, onChange }: { label: string; value: boolean; saving: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleHead}>
      <Text style={[font.body, { flex: 1 }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} disabled={saving} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.text} />
    </View>
  );
}

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
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  toggleHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepper: { flex: 1, gap: 6 },
  stepValue: { ...font.h2, minWidth: 36, textAlign: 'center' },
  error: { color: colors.danger },
});
