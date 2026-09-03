import { create } from 'zustand';

import { type MissionHistoryEntry, parseMissionHistory } from '@/protocol/models/history';
import { getSession } from './session';

const PAGE = 30;

interface HistoryStore {
  loading: boolean;
  loaded: boolean;
  loadingMore: boolean;
  error: string | null;
  items: MissionHistoryEntry[];
  load: () => Promise<void>;
  loadMore: () => Promise<void>;
  reset: () => void;
}

export const useHistory = create<HistoryStore>((set, get) => ({
  loading: false,
  loaded: false,
  loadingMore: false,
  error: null,
  items: [],

  load: async () => {
    const session = getSession();
    if (!session) {
      set({ error: 'Not connected', loaded: true });
      return;
    }
    set({ loading: true, error: null });
    try {
      const raw = await session.rest.getMissionHistory(session.blid, {
        maxReports: PAGE,
        filterType: 'omit_quickly_canceled_not_scheduled',
        supportedDoneCodes: ['dndEnd', 'returnHomeEnd'],
      });
      set({ items: parseMissionHistory(raw), loading: false, loaded: true });
    } catch (e) {
      set({ loading: false, loaded: true, error: (e as Error).message });
    }
  },

  loadMore: async () => {
    const session = getSession();
    const items = get().items;
    const last = items[items.length - 1];
    const cursor = last?.startTime ?? last?.timestamp;
    if (!session || cursor == null || get().loadingMore) return;
    set({ loadingMore: true });
    try {
      const raw = await session.rest.getMissionHistory(session.blid, {
        maxReports: PAGE,
        exclusiveStartTimestamp: cursor,
        filterType: 'omit_quickly_canceled_not_scheduled',
        supportedDoneCodes: ['dndEnd', 'returnHomeEnd'],
      });
      const more = parseMissionHistory(raw).filter((e) => !items.some((x) => x.key === e.key));
      set({ items: [...items, ...more], loadingMore: false });
    } catch (e) {
      set({ loadingMore: false, error: (e as Error).message });
    }
  },

  reset: () => set({ loading: false, loaded: false, loadingMore: false, error: null, items: [] }),
}));
