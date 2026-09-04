import type { JsonObject } from '../types';

/** cleanMissionStatus block, present in ro-currentstate (and the classic shadow on older tiers). */
export interface CleanMissionStatus {
  cycle: string | null; // none | clean | spot | quick | dock | evac | train | ...
  phase: string | null; // stop | charge | run | stuck | hmPostMsn | hmMidMsn | hmUsrDock | pause | padWash | ...
  error: number;
  notReady: number;
  condNotReady: number[];
  missionMinutes: number | null;
  rechargeMinutes: number | null;
  expireMinutes: number | null;
  sqft: number | null;
  nMissions: number | null;
  missionId: string | null;
  initiator: string | null;
  operatingMode: number | null;
  missionStartTime: number | null;
}

export interface DockStatus {
  /** Evacuation / general dock state code (300–365). */
  state: number | null;
  /** Pad wash state (600–669). */
  pwState: number | null;
  /** Pad dry state (700–757). */
  pdState: number | null;
  /** Fluid refill state (400–464). */
  frState: number | null;
  error: number | null;
  known: boolean | null;
  tankLvl: number | null;
  detergent: number | null;
  fwVer: string | null;
  hwRev: string | null;
  id: string | null;
  raw: JsonObject;
}

export interface RobotState {
  batPct: number | null;
  binPresent: boolean | null;
  binFull: boolean | null;
  tankPresent: boolean | null;
  tankLvl: number | null;
  detectedPad: string | null;
  mission: CleanMissionStatus;
  dock: DockStatus | null;
  lastCommand: JsonObject | null;
  pose: { x: number; y: number; theta: number } | null;
  signal: { rssi: number | null; snr: number | null } | null;
  name: string | null;
  sku: string | null;
  softwareVer: string | null;
  cap: Record<string, number>;
  p2maps: { p2map_id: string; p2mapv_id?: string }[];
  schedHold: boolean | null;
  /** Everything we did not model, for the debug view. */
  raw: JsonObject;
  updatedAt: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): JsonObject | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : null);

export function emptyMission(): CleanMissionStatus {
  return {
    cycle: null,
    phase: null,
    error: 0,
    notReady: 0,
    condNotReady: [],
    missionMinutes: null,
    rechargeMinutes: null,
    expireMinutes: null,
    sqft: null,
    nMissions: null,
    missionId: null,
    initiator: null,
    operatingMode: null,
    missionStartTime: null,
  };
}

export function parseMission(m: JsonObject | null): CleanMissionStatus {
  if (!m) return emptyMission();
  return {
    cycle: str(m.cycle),
    phase: str(m.phase),
    error: num(m.error) ?? 0,
    notReady: num(m.notReady) ?? 0,
    condNotReady: Array.isArray(m.condNotReady) ? (m.condNotReady as unknown[]).map(Number) : [],
    missionMinutes: num(m.mssnM),
    rechargeMinutes: num(m.rechrgM),
    expireMinutes: num(m.expireM),
    sqft: num(m.sqft),
    nMissions: num(m.nMssn),
    missionId: str(m.missionId),
    initiator: str(m.initiator),
    operatingMode: num(m.operatingMode),
    missionStartTime: num(m.mssnStrtTm),
  };
}

export function parseDock(d: JsonObject | null): DockStatus | null {
  if (!d) return null;
  return {
    state: num(d.state),
    pwState: num(d.pwState),
    pdState: num(d.pdState),
    frState: num(d.frState),
    error: num(d.error),
    known: bool(d.known),
    tankLvl: num(d.tankLvl),
    detergent: num(d.detergent),
    fwVer: str(d.fwVer),
    hwRev: str(d.hwRev),
    id: str(d.id),
    raw: d,
  };
}

export function emptyState(): RobotState {
  return {
    batPct: null,
    binPresent: null,
    binFull: null,
    tankPresent: null,
    tankLvl: null,
    detectedPad: null,
    mission: emptyMission(),
    dock: null,
    lastCommand: null,
    pose: null,
    signal: null,
    name: null,
    sku: null,
    softwareVer: null,
    cap: {},
    p2maps: [],
    schedHold: null,
    raw: {},
    updatedAt: 0,
  };
}

/**
 * Merges a `state.reported` fragment (from a GET or an update/accepted
 * message on any shadow) into the current RobotState. Fragments are
 * partial, so only keys present in `reported` are touched.
 */
export function mergeReported(prev: RobotState, reported: JsonObject): RobotState {
  const next: RobotState = { ...prev, raw: { ...prev.raw, ...reported }, updatedAt: Date.now() };
  if ('batPct' in reported) next.batPct = num(reported.batPct);
  const bin = obj(reported.bin);
  if (bin) {
    if ('present' in bin) next.binPresent = bool(bin.present);
    if ('full' in bin) next.binFull = bool(bin.full);
  }
  if ('tankPresent' in reported) next.tankPresent = bool(reported.tankPresent);
  if ('tankLvl' in reported) next.tankLvl = num(reported.tankLvl);
  if ('detectedPad' in reported) next.detectedPad = str(reported.detectedPad);
  const mission = obj(reported.cleanMissionStatus);
  if (mission) next.mission = { ...prev.mission, ...parseMissionPartial(mission) };
  const dock = obj(reported.dock);
  if (dock) next.dock = parseDock({ ...(prev.dock?.raw ?? {}), ...dock });
  if ('lastCommand' in reported) next.lastCommand = obj(reported.lastCommand);
  const pose = obj(reported.pose);
  if (pose) {
    const point = obj(pose.point);
    next.pose = { x: num(point?.x) ?? 0, y: num(point?.y) ?? 0, theta: num(pose.theta) ?? 0 };
  }
  const signal = obj(reported.signal);
  if (signal) next.signal = { rssi: num(signal.rssi), snr: num(signal.snr) };
  if ('name' in reported) next.name = str(reported.name);
  if ('sku' in reported) next.sku = str(reported.sku);
  if ('softwareVer' in reported) next.softwareVer = str(reported.softwareVer);
  const cap = obj(reported.cap);
  if (cap) next.cap = { ...prev.cap, ...(cap as Record<string, number>) };
  if (Array.isArray(reported.p2maps)) {
    next.p2maps = (reported.p2maps as JsonObject[]).map((m) => ({
      p2map_id: String(m.p2map_id ?? ''),
      p2mapv_id: typeof m.p2mapv_id === 'string' ? m.p2mapv_id : undefined,
    }));
  }
  if ('schedHold' in reported) next.schedHold = bool(reported.schedHold);
  return next;
}

function parseMissionPartial(m: JsonObject): Partial<CleanMissionStatus> {
  const full = parseMission(m);
  const out: Partial<CleanMissionStatus> = {};
  if ('cycle' in m) out.cycle = full.cycle;
  if ('phase' in m) out.phase = full.phase;
  if ('error' in m) out.error = full.error;
  if ('notReady' in m) out.notReady = full.notReady;
  if ('condNotReady' in m) out.condNotReady = full.condNotReady;
  if ('mssnM' in m) out.missionMinutes = full.missionMinutes;
  if ('rechrgM' in m) out.rechargeMinutes = full.rechargeMinutes;
  if ('expireM' in m) out.expireMinutes = full.expireMinutes;
  if ('sqft' in m) out.sqft = full.sqft;
  if ('nMssn' in m) out.nMissions = full.nMissions;
  if ('missionId' in m) out.missionId = full.missionId;
  if ('initiator' in m) out.initiator = full.initiator;
  if ('operatingMode' in m) out.operatingMode = full.operatingMode;
  if ('mssnStrtTm' in m) out.missionStartTime = full.missionStartTime;
  return out;
}

export type Activity =
  | 'idle'
  | 'charging'
  | 'cleaning'
  | 'paused'
  | 'returning'
  | 'stuck'
  | 'error'
  | 'evacuating'
  | 'washing'
  | 'drying'
  | 'refilling'
  | 'unknown';

export function isActiveMissionCycle(cycle: string | null | undefined): boolean {
  return !!cycle && cycle !== 'none';
}

/** Paused with a live cycle — `resume` still works. */
export function canResumeMission(s: RobotState): boolean {
  return activityOf(s) === 'paused' && isActiveMissionCycle(s.mission.cycle);
}

/** Mission is interrupted but can be continued (pause, pickup, cliff). */
export function canContinueMission(s: RobotState): boolean {
  const a = activityOf(s);
  return a === 'paused' || a === 'stuck';
}

/**
 * Pickup on Prime often jumps run → stop with cycle `none`. That is not
 * "returning to dock"; the job is gone and must be started again.
 */
export function interruptionFromTransition(prev: RobotState, next: RobotState): boolean {
  const prevPhase = prev.mission.phase;
  const nextPhase = next.mission.phase;
  if (nextPhase === 'hmPostMsn' || nextPhase === 'hmMidMsn' || nextPhase === 'hmUsrDock' || nextPhase === 'charge') {
    return false;
  }
  const wasWorking = prevPhase === 'run' || prevPhase === 'pause' || prevPhase === 'stuck';
  const cycleDropped = isActiveMissionCycle(prev.mission.cycle) && !isActiveMissionCycle(next.mission.cycle);
  if (wasWorking && cycleDropped) return true;
  if (wasWorking && (nextPhase === 'stop' || nextPhase === 'idle')) return true;
  if (nextPhase === 'stuck') return true;
  return false;
}

export function isMissionActivity(a: Activity): boolean {
  return a === 'cleaning' || a === 'paused' || a === 'returning' || a === 'stuck';
}

/** Collapses cycle/phase/error into one UI-friendly activity. */
export function activityOf(s: RobotState): Activity {
  const { phase, cycle, error } = s.mission;
  // Pickup / cliff / wheels-dropped still have a live mission. Treat those as
  // stuck so Home can offer Continue (resume) instead of a new clean.
  if (phase === 'stuck') return 'stuck';
  if (error && error !== 0) {
    if (isActiveMissionCycle(cycle) && phase !== 'charge') return 'stuck';
    return 'error';
  }
  switch (phase) {
    case 'charge':
      return 'charging';
    case 'run':
      if (cycle === 'evac') return 'evacuating';
      return 'cleaning';
    case 'pause':
      return 'paused';
    case 'hmPostMsn':
    case 'hmMidMsn':
    case 'hmUsrDock':
    case 'hmUsrChrg':
    case 'dock':
      return 'returning';
    case 'stop':
    case 'idle':
      return 'idle';
    case 'padWash':
    case 'padwash':
      return 'washing';
    case 'padDry':
    case 'paddry':
      return 'drying';
    case 'refill':
    case 'refilling':
      return 'refilling';
    case null:
      return 'unknown';
    default:
      break;
  }
  if (s.dock) {
    if (s.dock.pwState === 602 || s.dock.pwState === 604) return 'washing';
    if (s.dock.pdState === 702) return 'drying';
    if (s.dock.frState === 402 || s.dock.frState === 403) return 'refilling';
    if (s.dock.state === 302) return 'evacuating';
  }
  return 'unknown';
}

export const PHASE_LABELS: Record<string, string> = {
  charge: 'Charging',
  run: 'Cleaning',
  pause: 'Paused',
  stop: 'Ready',
  idle: 'Ready',
  stuck: 'Set down to continue',
  hmPostMsn: 'Returning to dock',
  hmMidMsn: 'Returning to recharge',
  hmUsrDock: 'Returning to dock',
  hmUsrChrg: 'Returning to charge',
  dock: 'Docking',
  chgerr: 'Charging error',
  padWash: 'Washing pads',
  padDry: 'Drying pads',
  evac: 'Emptying bin',
};

export function phaseLabel(s: RobotState): string {
  const a = activityOf(s);
  if (a === 'error') return 'Needs attention';
  if (s.mission.phase && PHASE_LABELS[s.mission.phase]) return PHASE_LABELS[s.mission.phase];
  return a.charAt(0).toUpperCase() + a.slice(1);
}
