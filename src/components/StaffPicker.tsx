import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { addStaff, getCurrentStaff, listStaff, removeStaff, setCurrentStaff } from '../db/repo';
import { Button, Field, Title } from './ui';
import { useColors } from '../theme';
import { useChanged, useQuery } from '../store';

/** Header button showing who's working on this phone. Scans and waste are logged under them. */
export function StaffPicker() {
  const c = useColors();
  const db = useSQLiteContext();
  const changed = useChanged();
  const current = useQuery(getCurrentStaff, null);
  const staff = useQuery(listStaff, []);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  async function pick(id: number) {
    await setCurrentStaff(db, id);
    setOpen(false);
    changed();
  }

  async function add() {
    if (!name.trim()) return;
    const s = await addStaff(db, name);
    setName('');
    await pick(s.id);
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={current ? `Working: ${current.name}. Change` : "Choose who's working"}
        onPress={() => setOpen(true)}
        style={[styles.chip, { borderColor: current ? c.line : c.warn, backgroundColor: current ? c.bg : c.warnSoft }]}
      >
        <Text style={{ color: current ? c.ink : c.warn, fontWeight: '600' }} numberOfLines={1}>
          {current ? current.name : "Who's working?"}
        </Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: c.surface }]}>
            <Title sub="Scans, waste and comps are logged under this person until someone else picks their name.">Who's working?</Title>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 6 }}>
              {staff.map(s => (
                <View key={s.id} style={{ flexDirection: 'row', gap: 6 }}>
                  <Button
                    title={s.name}
                    kind={current?.id === s.id ? 'primary' : 'plain'}
                    onPress={() => pick(s.id)}
                    style={{ flex: 1 }}
                  />
                  <Button title="Remove" kind="danger" onPress={() => removeStaff(db, s.id).then(changed)} />
                </View>
              ))}
              {!staff.length ? <Text style={{ color: c.muted }}>No staff yet. Add the first name below.</Text> : null}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Field style={{ flex: 1 }} value={name} onChangeText={setName} placeholder="Add a name" onSubmitEditing={add} returnKeyType="done" />
              <Button title="Add" kind="primary" onPress={add} disabled={!name.trim()} />
            </View>
            <Button title="Close" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6, maxWidth: 180 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { padding: 20, gap: 14, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
});
