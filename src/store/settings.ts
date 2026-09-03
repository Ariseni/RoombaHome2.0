import { create } from 'zustand';

import { reportedOf } from '@/protocol/mqtt/shadow';
import { householdIdForRobot, parseHouseholds } from '@/protocol/models/schedules';
import {
  type DndSettings,
  type RobotSettings,
  dndDailyBody,
  parseDnd,
  parseRobotSettings,
} from '@/protocol/models/settings';
import { getSession, useSession } from './session';

interface SettingsStore {
  loading: boolean;
  loaded: boolean;
  saving: string | null;
  error: string | null;
  settings: RobotSettings | null;
  dnd: DndSettings | null;
  householdId: string | null;
  load: () => Promise<void>;
  set: (key: string, value: unknown) => Promise<void>;
  setQuietHours: (startH: number, startM: number, endH: number, endM: number) => Promise<void>;
  reset: () => void;
}

function robotIds(): string[] {
  const session = getSession();
  const info = useSession.getState().robotInfo;
  const ids = new Set<string>();
  if (session) ids.add(session.blid);
  if (info?.blid) ids.add(info.blid);
  const raw = info?.raw;
  if (raw && typeof raw.robot_id === 'string') ids.add(raw.robot_id);
  return [...ids];
}

export const useSettings = create<SettingsStore>((set, get) => ({
  loading: false,
  loaded: false,
  saving: null,
  error: null,
  settings: null,
  dnd: null,
  householdId: null,

  load: async () => {
    const session = getSession();
    if (!session) {
      set({ error: 'Not connected', loaded: true });
      return;
    }
    set({ loading: true, error: null });
    try {
      const doc = await session.getShadow('rw-settings');
      const settings = parseRobotSettings(reportedOf(doc));
      let householdId = get().householdId;
      let dnd = get().dnd;
      if (!householdId) {
        householdId = householdIdForRobot(parseHouseholds(await session.rest.getUserHouseholds()), robotIds());
      }
      if (householdId) {
        try {
          dnd = parseDnd(await session.rest.getDndSettings(householdId));
        } catch {
          /* quiet hours are optional */
        }
      }
      set({ settings, dnd, householdId, loading: false, loaded: true });
    } catch (e) {
      set({ loading: false, loaded: true, error: (e as Error).message });
    }
  },

  set: async (key, value) => {
    const session = getSession();
    if (!session) return;
    set({ saving: key, error: null });
    try {
      await session.setSetting(key, value);
      await new Promise((r) => setTimeout(r, 800));
      const doc = await session.getShadow('rw-settings');
      set({ settings: parseRobotSettings(reportedOf(doc)), saving: null });
    } catch (e) {
      set({ saving: null, error: (e as Error).message });
    }
  },

  setQuietHours: async (startH, startM, endH, endM) => {
    const session = getSession();
    let householdId = get().householdId;
    if (!session) return;
    if (!householdId) await get().load();
    householdId = get().householdId;
    if (!householdId) {
      set({ error: 'No household on this account' });
      return;
    }
    set({ saving: 'dnd', error: null });
    try {
      await session.rest.setDndSettings(householdId, dndDailyBody(startH, startM, endH, endM));
      set({ dnd: parseDnd(await session.rest.getDndSettings(householdId)), saving: null });
    } catch (e) {
      set({ saving: null, error: (e as Error).message });
    }
  },

  reset: () =>
    set({ loading: false, loaded: false, saving: null, error: null, settings: null, dnd: null, householdId: null }),
}));
