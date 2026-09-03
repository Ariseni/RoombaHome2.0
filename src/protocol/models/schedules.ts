import { regionCommand, type Region } from '../commands';
import type { JsonObject } from '../types';

/** Wire weekday numbers. Sunday = 0 — same as `Date.getDay()`. */
export const WIRE_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type ScheduleFrequency = 'ONCE' | 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY';

const FREQUENCIES = new Set<ScheduleFrequency>(['ONCE', 'WEEKLY', 'BI_WEEKLY', 'MONTHLY']);

export interface Household {
  household_id: string;
  name: string | null;
  robot_ids: string[];
  raw: JsonObject;
}

export interface Schedule {
  schedule_id: string;
  household_schedule_id: string;
  household_id: string;
  name: string;
  enabled: boolean;
  frequency: ScheduleFrequency;
  days: number[];
  hour: number;
  minute: number;
  commands: JsonObject[];
  options: JsonObject;
}

function asObject(data: unknown): JsonObject | null {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as JsonObject) : null;
}

function asList(data: unknown): JsonObject[] {
  if (Array.isArray(data)) return data.filter((x): x is JsonObject => !!x && typeof x === 'object');
  return [];
}

function unwrapCommands(raw: unknown): JsonObject[] {
  return asList(raw).map((entry) => {
    const inner = entry.command;
    return inner && typeof inner === 'object' && !Array.isArray(inner) ? (inner as JsonObject) : entry;
  });
}

function wrapCommands(commands: JsonObject[]): JsonObject[] {
  return commands.map((c) => ({ command: c }));
}

export function parseHouseholds(data: unknown): Household[] {
  const obj = asObject(data);
  let entries: JsonObject[] = [];
  if (Array.isArray(data)) entries = asList(data);
  else if (obj) {
    if (Array.isArray(obj.household)) entries = asList(obj.household);
    else if (Array.isArray(obj.households)) entries = asList(obj.households);
    else if (obj.household_id != null || Array.isArray(obj.household_robots)) entries = [obj];
  }
  const out: Household[] = [];
  for (const raw of entries) {
    const id = raw.household_id;
    if (id == null) continue;
    const robots = asList(raw.household_robots);
    out.push({
      household_id: String(id),
      name: typeof raw.household_name === 'string' ? raw.household_name : null,
      robot_ids: robots.map((r) => String(r.robot_id ?? '')).filter(Boolean),
      raw,
    });
  }
  return out;
}

/** Match login BLID and any `robot_id` the account uses (they can differ). */
export function householdIdForRobot(households: Household[], ids: string[]): string | null {
  const set = new Set(ids.filter(Boolean));
  for (const h of households) {
    if (h.robot_ids.some((id) => set.has(id))) return h.household_id;
  }
  if (households.length === 1) return households[0].household_id;
  return null;
}

function parseTime(raw: unknown): { days: number[]; hour: number; minute: number } {
  const t = asObject(raw);
  const days = Array.isArray(t?.day)
    ? (t.day as unknown[]).map((d) => Number(d)).filter((d) => Number.isFinite(d) && d >= 0 && d <= 6)
    : [];
  return {
    days,
    hour: typeof t?.hour === 'number' ? t.hour : 9,
    minute: typeof t?.min === 'number' ? t.min : 0,
  };
}

export function parseSchedules(data: unknown, householdId: string): Schedule[] {
  const root = asObject(data);
  const containers = asList(root?.household_schedules ?? (Array.isArray(data) ? data : []));
  const out: Schedule[] = [];
  for (const container of containers) {
    const containerId = String(container.household_schedule_id ?? '');
    for (const raw of asList(container.schedules)) {
      const options = asObject(raw.options) ?? raw;
      if (options.deleted === true) continue;
      const id = String(raw.schedule_id ?? options.schedule_id ?? '');
      if (!id && !options.name) continue;
      const freqRaw = String(options.frequency ?? 'WEEKLY');
      const frequency = FREQUENCIES.has(freqRaw as ScheduleFrequency) ? (freqRaw as ScheduleFrequency) : 'WEEKLY';
      const time = parseTime(options.start);
      out.push({
        schedule_id: id,
        household_schedule_id: containerId,
        household_id: householdId,
        name: String(options.name ?? 'Untitled'),
        enabled: options.enabled !== false,
        frequency,
        days: time.days,
        hour: time.hour,
        minute: time.minute,
        commands: unwrapCommands(options.commands),
        options,
      });
    }
  }
  return out;
}

export function scheduleToJson(s: Schedule): JsonObject {
  return { schedule_id: s.schedule_id, options: s.options };
}

export function patchSchedule(s: Schedule, patch: Partial<Pick<Schedule, 'enabled' | 'name' | 'days' | 'hour' | 'minute' | 'frequency'>>): Schedule {
  const next: Schedule = { ...s, ...patch };
  const options: JsonObject = { ...s.options };
  if (patch.enabled != null) options.enabled = patch.enabled;
  if (patch.name != null) options.name = patch.name;
  if (patch.frequency != null) options.frequency = patch.frequency;
  if (patch.days != null || patch.hour != null || patch.minute != null) {
    const start = asObject(options.start) ?? {};
    options.start = {
      ...start,
      day: next.days,
      hour: next.hour,
      min: next.minute,
    };
  }
  next.options = options;
  return next;
}

export interface NewScheduleInput {
  robotId: string;
  name: string;
  days: number[];
  hour: number;
  minute: number;
  frequency?: ScheduleFrequency;
  commands: JsonObject[];
}

/** POST body: `{"schedules":[{"options":{...}}]}` — no `schedule_id`. */
export function createSchedulesBody(inputs: NewScheduleInput[]): JsonObject {
  return {
    schedules: inputs.map((input) => ({
      options: {
        robot_id: input.robotId,
        name: input.name,
        enabled: true,
        frequency: input.frequency ?? 'WEEKLY',
        start: { day: input.days, hour: input.hour, min: input.minute },
        commands: wrapCommands(input.commands),
      },
    })),
  };
}

export function updateSchedulesBody(schedules: Schedule[]): JsonObject {
  return { schedules: schedules.map(scheduleToJson) };
}

export function commandForSelection(blid: string, p2mapId: string | undefined, regions: Region[]): JsonObject {
  if (p2mapId && regions.length > 0) {
    const cmd = regionCommand({ blid, p2mapId, regions });
    const { time: _t, initiator: _i, ...rest } = cmd;
    return rest;
  }
  return { command: 'start', robot_id: blid, select_all: true };
}

export function daysLabel(days: number[]): string {
  if (days.length === 0) return 'No days';
  if (days.length === 7) return 'Every day';
  const weekend = days.length === 2 && days.includes(0) && days.includes(6);
  if (weekend) return 'Weekends';
  const weekday = [1, 2, 3, 4, 5].every((d) => days.includes(d)) && days.length === 5;
  if (weekday) return 'Weekdays';
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => WIRE_DAYS[d] ?? String(d))
    .join(', ');
}

export function timeLabel(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function commandsLabel(commands: JsonObject[]): string {
  const names: string[] = [];
  for (const c of commands) {
    if (c.select_all) return 'Whole house';
    for (const r of asList(c.regions)) {
      names.push(String(r.region_name ?? r.region_id ?? ''));
    }
  }
  if (names.length === 0) return commands.length ? 'Custom job' : 'Whole house';
  return names.filter(Boolean).join(', ');
}

/** Next start after `from`. Wire days already match `Date.getDay()`. */
export function nextOccurrence(s: Schedule, from = new Date()): Date | null {
  if (!s.enabled || s.days.length === 0) return null;
  const start = new Date(from);
  start.setSeconds(0, 0);
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    d.setHours(s.hour, s.minute, 0, 0);
    if (!s.days.includes(d.getDay())) continue;
    if (d.getTime() <= from.getTime()) continue;
    return d;
  }
  return null;
}

export function formatNext(d: Date | null): string {
  if (!d) return '—';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const when = timeLabel(d.getHours(), d.getMinutes());
  if (sameDay) return `Today ${when}`;
  if (isTomorrow) return `Tomorrow ${when}`;
  return `${WIRE_DAYS[d.getDay()]} ${when}`;
}
