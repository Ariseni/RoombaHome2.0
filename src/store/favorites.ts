import { create } from 'zustand';

import { regionCommand } from '@/protocol/commands';
import {
  type Favorite,
  favoriteRunPayloads,
  favoriteToJson,
  newFavoriteBody,
  parseFavorites,
} from '@/protocol/models/favorites';
import { useMaps } from './maps';
import { getSession, useSession } from './session';

interface FavoritesStore {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  items: Favorite[];
  load: () => Promise<void>;
  run: (fav: Favorite) => Promise<boolean>;
  createFromSelection: (name: string) => Promise<Favorite | null>;
  rename: (fav: Favorite, name: string) => Promise<void>;
  remove: (fav: Favorite) => Promise<void>;
}

export const useFavorites = create<FavoritesStore>((set, get) => ({
  loading: false,
  loaded: false,
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
      let items = parseFavorites(await session.rest.getFavorites('1'));
      if (items.length === 0) {
        items = parseFavorites(await session.rest.getFavorites('2'));
      }
      set({ items, loading: false, loaded: true });
    } catch (e) {
      set({ loading: false, loaded: true, error: (e as Error).message });
    }
  },

  run: async (fav) => {
    const session = getSession();
    const send = useSession.getState().sendCommand;
    if (!session) return false;
    const payloads = favoriteRunPayloads(fav, session.blid);
    for (const p of payloads) {
      const ok = await send(p, `fav:${fav.name}`);
      if (!ok) return false;
    }
    return true;
  },

  createFromSelection: async (name) => {
    const session = getSession();
    if (!session) {
      set({ error: 'Not connected' });
      return null;
    }
    const maps = useMaps.getState();
    const regions = maps.selectedRegions();
    const p2mapId = maps.active?.p2mapId;
    if (!p2mapId || regions.length === 0) {
      set({ error: 'Select rooms on the Map tab first' });
      return null;
    }
    const cmd = regionCommand({ blid: session.blid, p2mapId, regions });
    const { time: _t, initiator: _i, ...commanddef } = cmd;
    try {
      const created = await session.rest.createFavorite(newFavoriteBody({ name, commanddefs: [commanddef] }));
      await get().load();
      const id = String(created.favorite_id ?? '');
      return get().items.find((f) => f.favorite_id === id) ?? null;
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
    }
  },

  rename: async (fav, name) => {
    const session = getSession();
    if (!session) return;
    try {
      await session.rest.updateFavorite(fav.favorite_id, favoriteToJson({ ...fav, name }));
      await get().load();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  remove: async (fav) => {
    const session = getSession();
    if (!session) return;
    try {
      await session.rest.deleteFavorite(fav.favorite_id);
      set((st) => ({ items: st.items.filter((f) => f.favorite_id !== fav.favorite_id) }));
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
}));
