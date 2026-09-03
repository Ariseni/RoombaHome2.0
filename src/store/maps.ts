import { create } from 'zustand';

import { readBytesCache, readJsonCache, writeBytesCache, writeJsonCache } from '@/lib/storage';
import {
  type MapModel,
  type RoomFeature,
  type ZoneFeature,
  buildMapModel,
  parseBundleFiles,
  regionNamesFrom,
} from '@/protocol/maps/bundle';
import type { Region, RegionType } from '@/protocol/commands';
import type { ActiveMapVersion } from '@/protocol/rest';
import { getSession } from './session';

const CACHE_META = 'maps-meta';

export interface SelectedArea {
  id: string;
  type: RegionType;
  name: string | null;
}

interface MapsStore {
  loading: boolean;
  error: string | null;
  maps: ActiveMapVersion[];
  active: MapModel | null;
  selected: SelectedArea[];
  load: (force?: boolean) => Promise<void>;
  toggle: (area: SelectedArea) => void;
  clearSelection: () => void;
  selectedRegions: () => Region[];
  reset: () => void;
}

function cacheKey(p2mapId: string, version: string): string {
  return `bundle-${p2mapId}-${version}`;
}

export const useMaps = create<MapsStore>((set, get) => ({
  loading: false,
  error: null,
  maps: [],
  active: null,
  selected: [],

  load: async (force = false) => {
    const session = getSession();
    if (!session) {
      set({ error: 'Not connected' });
      return;
    }
    set({ loading: true, error: null });
    try {
      const maps = await session.rest.getActiveMapVersions(session.blid);
      writeJsonCache(CACHE_META, maps);
      const first = maps[0];
      if (!first) {
        set({ maps, active: null, loading: false });
        return;
      }
      const key = cacheKey(first.p2map_id, first.active_p2mapv_id);
      let bytes = force ? null : readBytesCache(key);
      if (!bytes) {
        const url = await session.rest.getMapBundleUrl(first.p2map_id, first.active_p2mapv_id);
        bytes = await session.rest.downloadBundle(url);
        writeBytesCache(key, bytes);
      }
      let versionDoc: unknown = null;
      try {
        versionDoc = await session.rest.getMapVersion(first.p2map_id, first.active_p2mapv_id);
      } catch {
        /* optional */
      }
      const files = parseBundleFiles(bytes);
      const model = buildMapModel({
        p2mapId: first.p2map_id,
        versionId: first.active_p2mapv_id,
        name: first.name ?? null,
        files,
        regionNames: regionNamesFrom(first, versionDoc),
      });
      set({ maps, active: model, loading: false });
    } catch (e) {
      const cached = readJsonCache<ActiveMapVersion[]>(CACHE_META);
      if (cached && !get().active) {
        // Try to reconstruct from a cached bundle of the first map.
        const first = cached[0];
        const bytes = first ? readBytesCache(cacheKey(first.p2map_id, first.active_p2mapv_id)) : null;
        if (first && bytes) {
          const model = buildMapModel({
            p2mapId: first.p2map_id,
            versionId: first.active_p2mapv_id,
            name: first.name ?? null,
            files: parseBundleFiles(bytes),
            regionNames: regionNamesFrom(first),
          });
          set({ maps: cached, active: model, loading: false, error: (e as Error).message });
          return;
        }
      }
      set({ loading: false, error: (e as Error).message });
    }
  },

  toggle: (area) => {
    set((st) => {
      const exists = st.selected.some((s) => s.id === area.id && s.type === area.type);
      return { selected: exists ? st.selected.filter((s) => !(s.id === area.id && s.type === area.type)) : [...st.selected, area] };
    });
  },

  clearSelection: () => set({ selected: [] }),

  selectedRegions: () =>
    get().selected.map((s) => ({
      region_id: s.id,
      type: s.type,
      region_name: s.name ?? undefined,
    })),

  reset: () => set({ maps: [], active: null, selected: [], error: null }),
}));

export function roomToArea(r: RoomFeature): SelectedArea {
  return { id: r.id, type: 'rid', name: r.name };
}

export function zoneToArea(z: ZoneFeature): SelectedArea {
  return { id: z.id, type: 'zid', name: z.name };
}
