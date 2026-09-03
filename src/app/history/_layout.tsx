import { Stack } from 'expo-router';

import { colors } from '@/ui/theme';

export default function HistoryLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    />
  );
}
