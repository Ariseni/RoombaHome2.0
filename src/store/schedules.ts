import { create } from 'zustand';

import {
  type NewScheduleInput,
  type Schedule,
  commandForSelection,
  createSchedulesBody,
  householdIdForRobot,
  parseHouseholds,
  parseSchedules,
  patchSchedule,
  updateSchedulesBody,
} from '@/protocol/models/schedules';
import { useMaps } from './maps';
import { getSession, useSession } from './session';

interface SchedulesStore {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  householdId: string | null;
  items: Schedule[];
  load: () => Promise<void>;
  setEnabled: (s: Schedule, enabled: boolean) => Promise<void>;
  create: (input: Omit<NewScheduleInput, 'robotId' | 'commands'> & { wholeHouse?: boolean }) => Promise<boolean>;
  remove: (s: Schedule) => Promise<void>;
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

export const useSchedules = create<SchedulesStore>((set, get) => ({
  loading: false,
  loaded: false,
  error: null,
  householdId: null,
  items: [],

  load: async () => {
    const session = getSession();
    if (!session) {
      set({ error: 'Not connected', loaded: true });
      return;
    }
    set({ loading: true, error: null });
    try {
      const households = parseHouseholds(await session.rest.getUserHouseholds());
      const householdId = householdIdForRobot(households, robotIds());
      if (!householdId) {
        set({ items: [], householdId: null, loading: false, loaded: true, error: 'No household on this account' });
        return;
      }
      const items = parseSchedules(await session.rest.getSchedules(householdId), householdId);
      set({ items, householdId, loading: false, loaded: true });
    } catch (e) {
      set({ loading: false, loaded: true, error: (e as Error).message });
    }
  },

  setEnabled: async (s, enabled) => {
    const session = getSession();
    if (!session) return;
    await get().load();
    const householdId = get().householdId;
    if (!householdId) return;
    const fresh = get().items.find(
      (x) => x.schedule_id === s.schedule_id && x.household_schedule_id === s.household_schedule_id,
    );
    if (!fresh) {
      set({ error: 'That schedule is gone. The list was refreshed.' });
      return;
    }
    const siblings = get().items.filter((x) => x.household_schedule_id === fresh.household_schedule_id);
    const next = siblings.map((x) => (x.schedule_id === fresh.schedule_id ? patchSchedule(x, { enabled }) : x));
    try {
      await session.rest.updateSchedules(householdId, fresh.household_schedule_id, updateSchedulesBody(next));
    } catch (e) {
      set({ error: (e as Error).message });
    }
    await get().load();
  },

  create: async (input) => {
    await get().load();
    const session = getSession();
    const householdId = get().householdId;
    if (!session || !householdId) {
      set({ error: 'No household yet — pull to refresh after you are online' });
      return false;
    }
    const maps = useMaps.getState();
    const regions = input.wholeHouse ? [] : maps.selectedRegions();
    const commands = [commandForSelection(session.blid, maps.active?.p2mapId, regions)];
    try {
      await session.rest.createSchedules(
        householdId,
        createSchedulesBody([
          {
            robotId: session.blid,
            name: input.name,
            days: input.days,
            hour: input.hour,
            minute: input.minute,
            frequency: input.frequency,
            commands,
          },
        ]),
      );
      await get().load();
      return true;
    } catch (e) {
      set({ error: (e as Error).message });
      return false;
    }
  },

  remove: async (s) => {
    const session = getSession();
    if (!session) return;
    await get().load();
    const householdId = get().householdId;
    if (!householdId) return;
    const stillThere = get().items.some(
      (x) => x.schedule_id === s.schedule_id && x.household_schedule_id === s.household_schedule_id,
    );
    if (!stillThere) {
      set({ error: 'That schedule is already gone. The list was refreshed.' });
      return;
    }
    const remaining = get().items.filter(
      (x) => x.household_schedule_id === s.household_schedule_id && x.schedule_id !== s.schedule_id,
    );
    try {
      if (remaining.length === 0) {
        await session.rest.deleteScheduleContainer(householdId, s.household_schedule_id);
      } else {
        await session.rest.updateSchedules(householdId, s.household_schedule_id, updateSchedulesBody(remaining));
      }
    } catch (e) {
      set({ error: (e as Error).message });
    }
    await get().load();
  },

  reset: () => set({ loading: false, loaded: false, error: null, householdId: null, items: [] }),
}));
