import { useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { roomsSummary } from '@/protocol/models/favorites';
import { useFavorites } from '@/store/favorites';
import { useMaps } from '@/store/maps';
import { useSession } from '@/store/session';
import { Button, Card, EmptyState, Screen } from '@/ui/components';
import { colors, font, radius, spacing } from '@/ui/theme';

export default function FavoritesScreen() {
  const status = useSession((s) => s.status);
  const commandBusy = useSession((s) => s.commandBusy);
  const { items, loading, loaded, error, load, run, createFromSelection, rename, remove } = useFavorites();
  const selected = useMaps((s) => s.selected);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  useEffect(() => {
    if (status === 'connected' && !loaded && !loading) load().catch(() => undefined);
  }, [status, loaded, loading, load]);

  const onRefresh = () => load();

  const save = async () => {
    const created = await createFromSelection(name.trim() || defaultName(selected.length));
    if (created) setName('');
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <Text style={font.title}>Favorites</Text>
        <Text style={[font.small, { marginBottom: spacing.sm }]}>Saved routines. Running one sends the stored rooms with initiator added — without that the robot ignores it.</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Card style={{ gap: spacing.sm }}>
          <Text style={font.h2}>Save current map selection</Text>
          <Text style={font.small}>
            {selected.length === 0
              ? 'Select rooms on the Map tab, then come back here.'
              : `${selected.length} room${selected.length === 1 ? '' : 's'}: ${selected.map((s) => s.name ?? s.id).join(', ')}`}
          </Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={selected.length ? defaultName(selected.length) : 'Name'}
            placeholderTextColor={colors.textDim}
          />
          <Button title="Save favorite" onPress={save} disabled={selected.length === 0 || status !== 'connected'} />
        </Card>

        {items.length === 0 && !loading ? (
          <EmptyState title="No favorites yet" subtitle="Save a room selection above, or create one in the official app — both lists share the same account." />
        ) : (
          items.map((fav) => (
            <Card key={fav.favorite_id} style={{ gap: spacing.sm }}>
              {renaming === fav.favorite_id ? (
                <TextInput style={styles.input} value={renameText} onChangeText={setRenameText} autoFocus />
              ) : (
                <Text style={font.h2}>{fav.name}</Text>
              )}
              <Text style={font.small}>{roomsSummary(fav)}</Text>
              <View style={styles.row}>
                <Button
                  title="Run"
                  compact
                  onPress={() => run(fav)}
                  loading={commandBusy === `fav:${fav.name}`}
                  disabled={status !== 'connected'}
                  style={{ flex: 1 }}
                />
                {renaming === fav.favorite_id ? (
                  <Button
                    title="Save"
                    variant="secondary"
                    compact
                    onPress={async () => {
                      if (renameText.trim()) await rename(fav, renameText.trim());
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <Button
                    title="Rename"
                    variant="ghost"
                    compact
                    onPress={() => {
                      setRenaming(fav.favorite_id);
                      setRenameText(fav.name);
                    }}
                  />
                )}
                <Button
                  title="Delete"
                  variant="ghost"
                  compact
                  onPress={() =>
                    Alert.alert('Delete favorite', `Remove “${fav.name}”?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => remove(fav) },
                    ])
                  }
                />
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function defaultName(n: number): string {
  return n === 1 ? '1 room' : `${n} rooms`;
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
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
  error: { color: colors.danger },
});
