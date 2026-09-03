import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { clearCache } from '@/lib/storage';
import { useMaps } from '@/store/maps';
import { getSession, useSession } from '@/store/session';
import { Button, Card, Pill, Screen, SectionTitle } from '@/ui/components';
import { colors, font, spacing } from '@/ui/theme';

export default function MoreScreen() {
  const router = useRouter();
  const robots = useSession((s) => s.robots);
  const robotInfo = useSession((s) => s.robotInfo);
  const selectedBlid = useSession((s) => s.selectedBlid);
  const selectRobot = useSession((s) => s.selectRobot);
  const signOut = useSession((s) => s.signOut);
  const reconnect = useSession((s) => s.reconnect);
  const status = useSession((s) => s.status);
  const login = useSession((s) => s.login);
  const robot = useSession((s) => s.robot);
  const dockReports = useSession((s) => s.dockReports);
  const timeline = useSession((s) => s.timeline);
  const resetMaps = useMaps((s) => s.reset);
  const [showRaw, setShowRaw] = useState(false);

  const confirmSignOut = () => {
    Alert.alert('Sign out', 'Remove the stored iRobot credentials from this phone?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={font.title}>More</Text>

        <SectionTitle>Robots</SectionTitle>
        <Card style={{ gap: spacing.sm }}>
          {robots.length === 0 ? <Text style={font.small}>No robots loaded yet.</Text> : null}
          {robots.map((r) => (
            <View key={r.blid} style={styles.robotRow}>
              <View style={{ flex: 1 }}>
                <Text style={font.body}>{r.name}</Text>
                <Text style={font.small}>
                  {r.sku} · fw {r.softwareVer} · {r.svcDeplId ?? '?'}
                </Text>
              </View>
              <Pill
                label={r.blid === (selectedBlid ?? robotInfo?.blid) ? 'Selected' : 'Select'}
                tone={r.blid === (selectedBlid ?? robotInfo?.blid) ? 'ok' : 'neutral'}
                selected={r.blid === (selectedBlid ?? robotInfo?.blid)}
                onPress={() => selectRobot(r.blid)}
              />
            </View>
          ))}
        </Card>

        <SectionTitle>Robot</SectionTitle>
        <Card style={{ gap: spacing.sm }}>
          <Button title="Settings" variant="secondary" onPress={() => router.push('/settings')} />
          <Button title="Schedules" variant="secondary" onPress={() => router.push('/schedules')} />
          <Button title="History" variant="secondary" onPress={() => router.push('/history')} />
        </Card>

        <SectionTitle>Connection</SectionTitle>
        <Card style={{ gap: spacing.sm }}>
          <Text style={font.small}>Status: {status}</Text>
          <Text style={font.small}>Deployment: {login?.deploymentId ?? '—'}</Text>
          <Text style={font.small}>MQTT: {login?.mqttEndpoint ?? '—'}</Text>
          <Text style={font.small}>REST: {login?.httpBaseAuth ?? '—'}</Text>
          <Text style={font.small}>Topic prefix: {login?.irbtTopicPrefix ?? '—'}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button title="Reconnect" variant="secondary" compact onPress={() => reconnect()} />
            <Button
              title="Clear map cache"
              variant="secondary"
              compact
              onPress={() => {
                clearCache();
                resetMaps();
              }}
            />
          </View>
        </Card>

        <SectionTitle right={<Pill label={showRaw ? 'Hide' : 'Show'} onPress={() => setShowRaw((v) => !v)} />}>
          Diagnostics
        </SectionTitle>
        {showRaw ? (
          <Card style={{ gap: spacing.md }}>
            <Text style={font.small}>Capabilities</Text>
            <Text style={font.mono}>{JSON.stringify(robotInfo?.cap ?? robot.cap, null, 1)}</Text>
            <Text style={font.small}>Last reported state (merged)</Text>
            <Text style={font.mono}>{JSON.stringify(robot.raw, null, 1)}</Text>
            <Text style={font.small}>Dock reports ({dockReports.length})</Text>
            <Text style={font.mono}>{JSON.stringify(dockReports.slice(0, 5), null, 1)}</Text>
            <Text style={font.small}>Mission timeline ({timeline.length})</Text>
            <Text style={font.mono}>{JSON.stringify(timeline.slice(0, 3), null, 1).slice(0, 4000)}</Text>
            <Button
              title="Log full state to console"
              variant="ghost"
              compact
              onPress={() => console.log(JSON.stringify({ robot, login: getSession()?.login?.raw }, null, 2))}
            />
          </Card>
        ) : null}

        <View style={{ marginTop: spacing.xl }}>
          <Button title="Sign out" variant="danger" onPress={confirmSignOut} />
        </View>
        <Text style={[font.small, { marginTop: spacing.lg, color: colors.textDim }]}>
          Roomba Home 2.0 is an unofficial app. Initial robot setup, firmware updates and smart-home linking still
          require the official Roomba Home app.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  robotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
