import { DEFAULT_INITIATOR, nowSeconds, type CommandPayload, type Region } from '../commands';
import type { JsonObject } from '../types';

export interface FavoriteCommandDef {
  command: string;
  robot_id?: string;
  p2map_id?: string;
  user_p2mapv_id?: string;
  favorite_id?: string;
  regions?: Region[];
  params?: JsonObject;
  ordered?: number | boolean;
  select_all?: boolean;
  initiator?: string;
  [key: string]: unknown;
}

export interface Favorite {
  favorite_id: string;
  name: string;
  color: string | null;
  icon: string | null;
  hidden: boolean;
  commanddefs: FavoriteCommandDef[];
  display_order: number | null;
  raw: JsonObject;
}

function asList(data: unknown): JsonObject[] {
  if (Array.isArray(data)) return data as JsonObject[];
  if (data && typeof data === 'object') {
    const o = data as JsonObject;
    for (const k of ['favorites', 'items', 'data']) {
      if (Array.isArray(o[k])) return o[k] as JsonObject[];
    }
  }
  return [];
}

function parseCommandDef(raw: JsonObject): FavoriteCommandDef {
  const regions = Array.isArray(raw.regions)
    ? (raw.regions as JsonObject[]).map((r) => ({
        region_id: String(r.region_id ?? r.id ?? ''),
        type: (String(r.type ?? 'rid') as Region['type']) || 'rid',
        region_name: typeof r.region_name === 'string' ? r.region_name : undefined,
        params: (r.params as FavoriteCommandDef['params']) ?? undefined,
      }))
    : undefined;
  return {
    ...raw,
    command: String(raw.command ?? 'start'),
    robot_id: typeof raw.robot_id === 'string' ? raw.robot_id : undefined,
    p2map_id: typeof raw.p2map_id === 'string' ? raw.p2map_id : undefined,
    regions,
  };
}

export function parseFavorites(data: unknown): Favorite[] {
  const out: Favorite[] = [];
  for (const raw of asList(data)) {
    const id = raw.favorite_id ?? raw.id;
    if (id == null) continue;
    const hidden = Boolean(raw.hidden ?? raw.is_hidden);
    const deleted = Boolean(raw.deleted ?? raw.is_deleted);
    if (hidden || deleted) continue;
    const defsRaw = raw.commanddefs ?? raw.command_defs ?? raw.commandDefs;
    out.push({
      favorite_id: String(id),
      name: String(raw.name ?? 'Untitled'),
      color: typeof raw.color === 'string' ? raw.color : null,
      icon: typeof raw.icon === 'string' ? raw.icon : null,
      hidden,
      commanddefs: Array.isArray(defsRaw) ? (defsRaw as JsonObject[]).map(parseCommandDef) : [],
      display_order: typeof raw.display_order === 'number' ? raw.display_order : null,
      raw,
    });
  }
  return out.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
}

export function favoriteToJson(f: Favorite): JsonObject {
  const body: JsonObject = {
    ...f.raw,
    name: f.name,
    hidden: false,
    deleted: false,
    default: false,
    commanddefs: f.commanddefs,
  };
  if (f.color) body.color = f.color;
  if (f.icon) body.icon = f.icon;
  if (f.display_order != null) body.display_order = f.display_order;
  return body;
}

export interface NewFavoriteInput {
  name: string;
  color?: string;
  commanddefs: FavoriteCommandDef[];
}

export function newFavoriteBody(input: NewFavoriteInput): JsonObject {
  return {
    name: input.name,
    hidden: false,
    deleted: false,
    default: false,
    commanddefs: input.commanddefs,
    ...(input.color ? { color: input.color } : {}),
  };
}

/**
 * A stored favorite is silently ignored unless `initiator` is added at
 * send time. Map each commanddef onto a cmd-topic payload.
 */
export function favoriteRunPayloads(fav: Favorite, blid: string, initiator = DEFAULT_INITIATOR): CommandPayload[] {
  const defs = fav.commanddefs.length ? fav.commanddefs : [{ command: 'start', favorite_id: fav.favorite_id }];
  return defs.map((d) => {
    const payload: CommandPayload = {
      ...d,
      command: d.command || 'start',
      time: nowSeconds(),
      initiator,
    };
    if (!payload.robot_id) payload.robot_id = blid;
    if (!payload.favorite_id) payload.favorite_id = fav.favorite_id;
    return payload;
  });
}

export function roomsSummary(fav: Favorite): string {
  const names: string[] = [];
  for (const d of fav.commanddefs) {
    if (d.select_all) return 'Whole house';
    for (const r of d.regions ?? []) names.push(r.region_name || r.region_id);
  }
  if (names.length === 0) return 'Whole house';
  return names.join(', ');
}
