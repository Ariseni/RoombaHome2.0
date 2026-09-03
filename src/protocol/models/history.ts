import type { JsonObject } from '../types';

const DONE_LABELS: Record<string, string> = {
  ok: 'Finished',
  busy: 'Busy',
  dndEnd: 'Quiet hours',
  returnHomeEnd: 'Sent home',
  timeboxEnd: 'Time limit',
  cncl: 'Canceled',
  usrSlp: 'Sleep',
  plcDoc: 'Placed on dock',
  usrEnd: 'Stopped',
  usrSpt: 'Spot clean',
  batcncl: 'Battery',
  stuck: 'Stuck',
  battery: 'Battery',
  cancel: 'Canceled',
};

const ROOM_STATUS: Record<number, string> = {
  0: 'Finished',
  1: 'More passes',
  2: 'Partial',
  3: 'Partial skip',
  4: 'Moved',
  5: 'Stopped',
  6: 'Aborted',
  7: 'Skipped',
  8: 'Will return',
};

export interface HistoryRegion {
  region_id: string;
  type: string;
  name: string | null;
}

export interface RoomVisit {
  region_id: string;
  coverage: number | null;
  area: number | null;
  totalArea: number | null;
  status: number | null;
  statusLabel: string | null;
}

export interface HistoryCommand {
  command: string | null;
  initiator: string | null;
  p2mapId: string | null;
  mapVersionId: string | null;
  favoriteId: string | null;
  selectAll: boolean;
  regions: HistoryRegion[];
}

export interface MissionHistoryEntry {
  key: string;
  missionId: string | null;
  nMission: number | null;
  startTime: number | null;
  timestamp: number | null;
  durationM: number | null;
  runM: number | null;
  pauseM: number | null;
  chargeM: number | null;
  done: string | null;
  doneLabel: string;
  errorCode: number | null;
  sqft: number | null;
  evacs: number | null;
  dirt: number | null;
  command: HistoryCommand | null;
  visits: RoomVisit[];
  raw: JsonObject;
}

function asObject(data: unknown): JsonObject | null {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as JsonObject) : null;
}

function asList(data: unknown): JsonObject[] {
  if (Array.isArray(data)) return data.filter((x): x is JsonObject => !!x && typeof x === 'object');
  return [];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : v != null && typeof v !== 'object' ? String(v) : null;
}

function parseCommand(raw: unknown): HistoryCommand | null {
  const c = asObject(raw);
  if (!c) return null;
  const regions = asList(c.regions).map((r) => ({
    region_id: String(r.region_id ?? r.id ?? ''),
    type: String(r.type ?? 'rid'),
    name: str(r.region_name ?? r.name),
  })).filter((r) => r.region_id);
  return {
    command: str(c.command),
    initiator: str(c.initiator),
    p2mapId: str(c.p2map_id ?? c.mapId),
    mapVersionId: str(c.user_p2mapv_id ?? c.mapVersionId),
    favoriteId: str(c.favorite_id ?? c.favoriteId),
    selectAll: c.cleanAll === true || c.select_all === true,
    regions,
  };
}

function parseVisits(raw: JsonObject): RoomVisit[] {
  const timeline = asObject(raw.timeline);
  const events = asList(timeline?.finEvents ?? timeline?.events ?? raw.timeline);
  const out: RoomVisit[] = [];
  for (const ev of events) {
    const room = asObject(ev.room) ?? (ev.rid || ev.regionId ? ev : null);
    if (!room) continue;
    const region_id = str(room.rid ?? room.regionId);
    if (!region_id) continue;
    let coverage = num(room.coverage);
    if (coverage != null && coverage > 1) coverage = coverage / 100;
    out.push({
      region_id,
      coverage,
      area: num(room.area),
      totalArea: num(room.totalArea),
      status: num(room.status),
      statusLabel: num(room.status) != null ? ROOM_STATUS[room.status as number] ?? `Status ${room.status}` : null,
    });
  }
  return out;
}

export function parseMissionHistory(data: unknown): MissionHistoryEntry[] {
  const entries = Array.isArray(data) ? data : asList(asObject(data)?.missions ?? asObject(data)?.history);
  const out: MissionHistoryEntry[] = [];
  for (const raw of asList(entries)) {
    const startTime = num(raw.startTime);
    const timestamp = num(raw.timestamp);
    const missionId = str(raw.missionId);
    const done = str(raw.done ?? raw.done_raw);
    const command = parseCommand(raw.cmd ?? raw.command);
    const key = `${timestamp ?? startTime ?? ''}-${missionId ?? out.length}`;
    out.push({
      key,
      missionId,
      nMission: num(raw.nMssn),
      startTime,
      timestamp,
      durationM: num(raw.durationM),
      runM: num(raw.runM),
      pauseM: num(raw.pauseM),
      chargeM: num(raw.chrgM),
      done,
      doneLabel: (done && DONE_LABELS[done]) || done || 'Unknown',
      errorCode: num(raw.errorCode),
      sqft: num(raw.sqft),
      evacs: num(raw.evacs),
      dirt: num(raw.dirt ?? raw.numberOfDirtDetects),
      command,
      visits: parseVisits(raw),
      raw,
    });
  }
  return out.sort((a, b) => (b.startTime ?? b.timestamp ?? 0) - (a.startTime ?? a.timestamp ?? 0));
}

export function historyWhen(e: MissionHistoryEntry): string {
  const ts = e.startTime ?? e.timestamp;
  if (!ts) return 'Unknown time';
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return 'Unknown time';
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function historyAreaM2(sqft: number | null): string {
  if (sqft == null) return '—';
  return `${(sqft * 0.0929).toFixed(0)} m²`;
}

export function historyRooms(e: MissionHistoryEntry, names?: Record<string, string>): string {
  if (e.command?.selectAll && e.visits.length === 0) return 'Whole house';
  const fromCmd = Object.fromEntries((e.command?.regions ?? []).map((r) => [r.region_id, r.name]));
  const label = (id: string) => names?.[id] || fromCmd[id] || id;
  const fromVisits = e.visits.map((v) => label(v.region_id));
  if (fromVisits.length) return unique(fromVisits).join(', ');
  const named = (e.command?.regions ?? []).map((r) => label(r.region_id));
  if (named.length) return unique(named).join(', ');
  return e.command?.selectAll ? 'Whole house' : '—';
}

export function highlightCoverage(e: MissionHistoryEntry): { id: string; coverage: number | null }[] {
  const byId = new Map<string, { id: string; coverage: number | null }>();
  for (const r of e.command?.regions ?? []) byId.set(r.region_id, { id: r.region_id, coverage: null });
  for (const v of e.visits) {
    const prev = byId.get(v.region_id);
    const coverage = v.coverage ?? prev?.coverage ?? null;
    byId.set(v.region_id, { id: v.region_id, coverage });
  }
  return [...byId.values()];
}

function unique(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}
