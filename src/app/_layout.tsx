import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useSession } from '@/store/session';
import { colors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000, gcTime: 24 * 60 * 60_000 } },
});

export default function RootLayout() {
  const bootstrap = useSession((s) => s.bootstrap);
  const authState = useSession((s) => s.authState);

  useEffect(() => {
    bootstrap().catch(() => undefined);
  }, [bootstrap]);

  useEffect(() => {
    if (authState !== 'loading') SplashScreen.hideAsync().catch(() => undefined);
  }, [authState]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="clean" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="schedules" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="history" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
