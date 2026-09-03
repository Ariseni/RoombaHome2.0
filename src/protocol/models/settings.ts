import type { JsonObject } from '../types';

export interface RobotSettings {
  childLock: boolean | null;
  volume: number | null;
  ecoCharge: boolean | null;
  carpetBoost: boolean | null;
  twoPass: boolean | null;
  vacHigh: boolean | null;
  noAutoPasses: boolean | null;
  evacAllowed: boolean | null;
  autoevacFreq: number | null;
  padWashAllowed: boolean | null;
  padDryAllowed: boolean | null;
  padWashReturn: number | null;
  padWashArea: number | null;
  padWashTime: number | null;
  padDryDuration: number | null;
  padWashHeat: number | null;
  name: string | null;
  timezone: string | null;
  raw: JsonObject;
}

export interface DndSettings {
  dailyStart: number | null;
  dailyEnd: number | null;
  endsAt: number | null;
  raw: JsonObject;
}

function asObject(data: unknown): JsonObject | null {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as JsonObject) : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}

export function parseRobotSettings(reported: unknown): RobotSettings {
  const raw = asObject(reported) ?? {};
  const audio = asObject(raw.audio);
  const volume = num(raw['audio.volume'] ?? audio?.volume);
  return {
    childLock: bool(raw.childLock),
    volume,
    ecoCharge: bool(raw.ecoCharge),
    carpetBoost: bool(raw.carpetBoost),
    twoPass: bool(raw.twoPass),
    vacHigh: bool(raw.vacHigh),
    noAutoPasses: bool(raw.noAutoPasses),
    evacAllowed: bool(raw.evacAllowed),
    autoevacFreq: num(raw.autoevacFreq),
    padWashAllowed: bool(raw.padWashAllowed),
    padDryAllowed: bool(raw.padDryAllowed),
    padWashReturn: num(raw.pwReturn),
    padWashArea: num(raw.pwAreaInterval),
    padWashTime: num(raw.pwTimeInterval),
    padDryDuration: num(raw.padDryDur),
    padWashHeat: num(raw.pwHeat),
    name: str(raw.name),
    timezone: str(raw.timezone),
    raw,
  };
}

export function parseDnd(data: unknown): DndSettings {
  const raw = asObject(data) ?? {};
  return {
    dailyStart: num(raw.dailyStart),
    dailyEnd: num(raw.dailyEnd),
    endsAt: num(raw.endsAt),
    raw,
  };
}

export function dndDailyBody(startHour: number, startMin: number, endHour: number, endMin: number): JsonObject {
  return {
    dailyStart: startHour * 60 + startMin,
    dailyEnd: endHour * 60 + endMin,
  };
}

export function minutesToClock(mins: number | null | undefined): { hour: number; minute: number } | null {
  if (mins == null || mins < 0) return null;
  return { hour: Math.floor(mins / 60) % 24, minute: mins % 60 };
}

export function clockLabel(mins: number | null | undefined): string {
  const c = minutesToClock(mins);
  if (!c) return '—';
  return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}

export const WASH_RETURN: { value: number; label: string }[] = [
  { value: 0, label: 'After each room' },
  { value: 1, label: 'After a time' },
  { value: 2, label: 'After an area' },
];

export function evacFreqOptions(cap: number | undefined): { value: number; label: string }[] {
  if (!cap) return [];
  const every = [
    { value: 0, label: 'Every clean' },
    { value: 1, label: 'Every 2nd' },
    { value: 2, label: 'Every 3rd' },
  ];
  if (cap === 1) return every;
  if (cap === 2) return [
    { value: 0, label: 'Every clean' },
    { value: 15, label: 'Every 14 m²' },
    { value: 25, label: 'Every 23 m²' },
  ];
  if (cap >= 3) return [...every, { value: 4, label: 'On dock return' }];
  return [];
}

export function areaIntervalLabel(units: number | null): string {
  if (units == null) return '—';
  return `${Math.round(units * 10 * 0.0929)} m²`;
}
