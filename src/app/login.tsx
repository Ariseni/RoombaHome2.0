import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthRateLimitedError } from '@/protocol/errors';
import { useSession } from '@/store/session';
import { Button, Card, Screen } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

const COUNTRIES = ['US', 'CA', 'GB', 'DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'AT', 'CH', 'PL', 'SE', 'DK', 'NO', 'FI', 'CZ', 'PT', 'IE', 'AU', 'NZ', 'JP'];

export default function LoginScreen() {
  const authState = useSession((s) => s.authState);
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('DE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authState === 'signedIn') return <Redirect href="/(tabs)" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn({ username: email.trim(), password, countryCode: country });
    } catch (e) {
      const err = e as Error;
      setError(
        err instanceof AuthRateLimitedError
          ? 'iRobot refused: too many active sessions. Close the official Roomba app, wait a minute, and retry.'
          : err.message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={font.title}>Roomba Home 2.0</Text>
          <Text style={[font.small, { marginTop: spacing.xs, marginBottom: spacing.xl }]}>
            Sign in with your iRobot account. Credentials are stored only on this phone (Android Keystore) and sent
            only to iRobot's servers.
          </Text>

          <Card>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="Email"
              placeholderTextColor={colors.textDim}
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              placeholder="••••••••"
              placeholderTextColor={colors.textDim}
              onSubmitEditing={submit}
            />
            <Text style={styles.label}>Country of your iRobot account</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {COUNTRIES.map((c) => (
                <Text
                  key={c}
                  onPress={() => setCountry(c)}
                  style={[styles.country, c === country && styles.countryActive]}
                >
                  {c}
                </Text>
              ))}
            </ScrollView>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              title="Sign in"
              onPress={submit}
              loading={busy}
              disabled={!email || !password}
              style={{ marginTop: spacing.lg }}
            />
          </Card>

          <View style={{ marginTop: spacing.xl }}>
            <Text style={font.small}>
              Tip: iRobot allows a limited number of simultaneous app sessions per account. If sign-in is refused, close
              the official app first.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, paddingTop: spacing.xxl * 2 },
  label: { ...font.small, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
  },
  country: {
    color: colors.textMuted,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  countryActive: { color: colors.bg, backgroundColor: colors.accent, borderColor: colors.accent, fontWeight: '600' },
  error: { color: colors.danger, marginTop: spacing.md },
});
