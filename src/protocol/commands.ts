/**
 * Command payload builders for the `{irbtTopics}/things/{blid}/cmd` topic.
 *
 * Wire shapes follow what was confirmed on real Prime/V4 hardware:
 *  - simple:  {"command":"start","time":<unix s>,"initiator":"localApp"}
 *  - regions: {"command":"start","robot_id":..,"p2map_id":..,"regions":[{"region_id":"12","type":"rid"}],
 *              "ordered":1,"select_all":false,"params":{...},"initiator":"localApp","time":..}
 * `initiator` is mandatory; without it the robot ACKs and ignores the command.
 */

export type SimpleCommand =
  | 'start'
  | 'stop'
  | 'pause'
  | 'resume'
  | 'dock'
  | 'find'
  | 'evac'
  | 'stopevac'
  | 'washpad'
  | 'drypad'
  | 'stoppaddry'
  | 'flrefill'
  | 'train'
  | 'reset'
  | 'start_dnd'
  | 'stop_dnd';

export const DOCK_COMMANDS: Record<string, SimpleCommand> = {
  emptyBin: 'evac',
  stopEmptyBin: 'stopevac',
  washPads: 'washpad',
  dryPads: 'drypad',
  stopDryPads: 'stoppaddry',
  refillTank: 'flrefill',
};

/** cap.oMode / params.operatingMode bit values. */
export const OperatingMode = {
  TRAVELING: 1,
  VACUUMING: 2,
  MOP_ONLY: 4,
  VIDEO_STREAMING: 8,
  AIR_PURIFYING: 16,
  VAC_MOP_COMBO_ONLY: 32,
  SCRUBBING: 64,
  MOWING: 128,
  MOPPING: 256,
  VAC_THEN_MOP: 512,
} as const;

/** Convenience presets used by the UI. */
export type CleanMode = 'vacuum' | 'mop' | 'vacuum_and_mop' | 'vacuum_then_mop';

export function operatingModeFor(mode: CleanMode): number {
  switch (mode) {
    case 'vacuum':
      return OperatingMode.VACUUMING;
    case 'mop':
      return OperatingMode.MOP_ONLY;
    case 'vacuum_and_mop':
      return OperatingMode.VAC_MOP_COMBO_ONLY;
    case 'vacuum_then_mop':
      return OperatingMode.VAC_THEN_MOP;
  }
}

export function cleanModeFromOperatingMode(om: number | null | undefined): CleanMode | null {
  if (om == null) return null;
  if (om & OperatingMode.VAC_THEN_MOP) return 'vacuum_then_mop';
  if (om & OperatingMode.VAC_MOP_COMBO_ONLY) return 'vacuum_and_mop';
  if (om & OperatingMode.MOP_ONLY) return 'mop';
  if (om & OperatingMode.VACUUMING) return 'vacuum';
  return null;
}

/** Which modes the robot advertises in cap.oMode. */
export function supportedCleanModes(oMode: number | undefined): CleanMode[] {
  if (!oMode) return ['vacuum'];
  const out: CleanMode[] = [];
  if (oMode & OperatingMode.VACUUMING) out.push('vacuum');
  if (oMode & OperatingMode.MOP_ONLY) out.push('mop');
  if (oMode & OperatingMode.VAC_MOP_COMBO_ONLY) out.push('vacuum_and_mop');
  if (oMode & OperatingMode.VAC_THEN_MOP) out.push('vacuum_then_mop');
  return out.length ? out : ['vacuum'];
}

/** suctionLevel: 1 low, 2 medium, 3 high, 4 turbo (cap.suctionLvl = count). */
export type SuctionLevel = 1 | 2 | 3 | 4;

/**
 * padWetness: disposable/reusable use 0 damp, 1 moderate, 2 wet;
 * padPlate (hard pad plate, the 505's mop) is offset: 1 damp, 2 moderate, 3 wet.
 */
export type WetnessLevel = 'damp' | 'moderate' | 'wet';

export function padWetnessParam(level: WetnessLevel): { disposable: number; reusable: number; padPlate: number } {
  const idx = { damp: 0, moderate: 1, wet: 2 }[level];
  return { disposable: idx, reusable: idx, padPlate: idx + 1 };
}

export interface CommandParams {
  operatingMode?: number;
  suctionLevel?: SuctionLevel;
  padWetness?: { disposable: number; reusable: number; padPlate: number };
  twoPass?: boolean;
  carpetBoost?: boolean;
  noAutoPasses?: boolean;
  swScrub?: number;
  vacHigh?: boolean;
  padWashAfter?: number;
  padWashArea?: number;
  [key: string]: unknown;
}

export interface CleanOptions {
  mode?: CleanMode;
  suction?: SuctionLevel;
  wetness?: WetnessLevel;
  passes?: 1 | 2;
}

export function buildParams(opts: CleanOptions | undefined): CommandParams | undefined {
  if (!opts) return undefined;
  const p: CommandParams = {};
  if (opts.mode) p.operatingMode = operatingModeFor(opts.mode);
  if (opts.suction) p.suctionLevel = opts.suction;
  if (opts.wetness && opts.mode && opts.mode !== 'vacuum') p.padWetness = padWetnessParam(opts.wetness);
  if (opts.passes) {
    p.twoPass = opts.passes === 2;
    p.noAutoPasses = opts.passes === 1;
  }
  return Object.keys(p).length ? p : undefined;
}

export type RegionType = 'rid' | 'zid' | 'tid';

export interface Region {
  region_id: string;
  type: RegionType;
  region_name?: string;
  params?: CommandParams;
}

export interface CommandPayload {
  command: string;
  time: number;
  initiator: string;
  [key: string]: unknown;
}

export const DEFAULT_INITIATOR = 'localApp';

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function simpleCommand(command: SimpleCommand | string, initiator = DEFAULT_INITIATOR): CommandPayload {
  return { command, time: nowSeconds(), initiator };
}

/** Whole-house start with optional mode/suction/wetness parameters. */
export function startCommand(params?: CommandParams, initiator = DEFAULT_INITIATOR): CommandPayload {
  const p: CommandPayload = simpleCommand('start', initiator);
  if (params) p.params = params;
  return p;
}

export interface RegionCommandInput {
  blid: string;
  p2mapId: string;
  regions: Region[];
  /** Optional; the robot re-versions its map constantly, so a stale one is harmless. */
  mapVersionId?: string;
  params?: CommandParams;
  ordered?: boolean;
  initiator?: string;
}

/** Room / zone targeted clean. */
export function regionCommand(input: RegionCommandInput): CommandPayload {
  if (input.regions.length === 0) throw new Error('regionCommand needs at least one region');
  for (const r of input.regions) {
    if (!r.region_id) throw new Error('Region without id');
  }
  const body: CommandPayload = {
    command: 'start',
    robot_id: input.blid,
    ordered: input.ordered === false ? 0 : 1,
    select_all: false,
    p2map_id: input.p2mapId,
    regions: input.regions.map((r) => {
      const out: Record<string, unknown> = { region_id: r.region_id, type: r.type };
      if (r.region_name) out.region_name = r.region_name;
      if (r.params) out.params = r.params;
      return out;
    }),
    time: nowSeconds(),
    initiator: input.initiator ?? DEFAULT_INITIATOR,
  };
  if (input.mapVersionId) body.user_p2mapv_id = input.mapVersionId;
  if (input.params) body.params = input.params;
  return body;
}
