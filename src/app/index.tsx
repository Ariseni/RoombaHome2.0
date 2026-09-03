import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useSession } from '@/store/session';
import { colors } from '@/ui/theme';

export default function Index() {
  const authState = useSession((s) => s.authState);
  if (authState === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return <Redirect href={authState === 'signedIn' ? '/(tabs)' : '/login'} />;
}
