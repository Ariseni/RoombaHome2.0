/**
 * Dock state codes reported in the `dock` block (state / frState /
 * pwState / pdState) and in dock/*\/report messages.
 * Evacuation 300–365, fluid refill 400–464, pad wash 600–669, pad dry 700–757.
 */

export interface DockStateInfo {
  code: number;
  label: string;
  kind: 'evac' | 'refill' | 'wash' | 'dry' | 'other';
  severity: 'ok' | 'busy' | 'warn' | 'error';
}

const TABLE: Record<number, [string, DockStateInfo['kind'], DockStateInfo['severity']]> = {
  0: ['OK', 'other', 'ok'],
  300: ['Unknown', 'evac', 'warn'],
  301: ['Ready', 'evac', 'ok'],
  302: ['Emptying bin', 'evac', 'busy'],
  303: ['Bin emptied', 'evac', 'ok'],
  304: ['Stopping evacuation', 'evac', 'busy'],
  305: ['Dock updating', 'evac', 'busy'],
  350: ['Bag missing', 'evac', 'error'],
  351: ['Dock clogged', 'evac', 'error'],
  352: ['Dock vacuum inoperable', 'evac', 'error'],
  353: ['Bag full', 'evac', 'error'],
  354: ['Dock motor failure', 'evac', 'error'],
  355: ['Dock partially clogged', 'evac', 'warn'],
  360: ['Dock communication failure', 'evac', 'error'],
  361: ['Evacuation report error', 'evac', 'warn'],
  362: ['Lifetime data report error', 'evac', 'warn'],
  363: ['Dock reports error', 'evac', 'warn'],
  365: ['Dock hardware issue', 'evac', 'error'],
  400: ['Unknown', 'refill', 'warn'],
  401: ['Ready', 'refill', 'ok'],
  402: ['Refill started', 'refill', 'busy'],
  403: ['Refilling tank', 'refill', 'busy'],
  404: ['Tank refilled', 'refill', 'ok'],
  405: ['Refilled (not enough water)', 'refill', 'warn'],
  449: ['Invalid dock state', 'refill', 'error'],
  450: ['Clean water tank missing', 'refill', 'error'],
  451: ['Clean water too low', 'refill', 'error'],
  452: ['Tank level sensor issue', 'refill', 'error'],
  453: ["Couldn't insert snorkel", 'refill', 'error'],
  454: ['Refill clogged', 'refill', 'error'],
  455: ['Refill pump failure', 'refill', 'error'],
  456: ['Incorrect robot tank', 'refill', 'error'],
  457: ['Refill communication failure', 'refill', 'error'],
  458: ["Couldn't extend snorkel", 'refill', 'error'],
  459: ["Couldn't retract snorkel", 'refill', 'error'],
  460: ['Dock tank not draining', 'refill', 'error'],
  461: ['Robot tank not filling', 'refill', 'error'],
  462: ['Refill hardware issue', 'refill', 'error'],
  463: ['Dock tank level decreasing', 'refill', 'error'],
  464: ['Robot tank filling timeout', 'refill', 'error'],
  600: ['Unknown', 'wash', 'warn'],
  601: ['Ready', 'wash', 'ok'],
  602: ['Washing pads', 'wash', 'busy'],
  603: ['Pads washed', 'wash', 'ok'],
  604: ['Wetting pads', 'wash', 'busy'],
  605: ['Pads wetted', 'wash', 'ok'],
  606: ['Wash unavailable (dock updating)', 'wash', 'warn'],
  607: ['Flushing sluice', 'wash', 'busy'],
  608: ['Sluice flushed', 'wash', 'ok'],
  649: ['Invalid dock state', 'wash', 'error'],
  650: ['Clean water tank missing', 'wash', 'error'],
  651: ['Clean water too low', 'wash', 'error'],
  652: ['Clean water sensor issue', 'wash', 'error'],
  653: ['Dirty water tank missing', 'wash', 'error'],
  654: ['Dirty water tank full', 'wash', 'error'],
  655: ['Pad wash hardware error', 'wash', 'error'],
  660: ['Pad wash communication failure', 'wash', 'error'],
  661: ['Dirty water not draining', 'wash', 'error'],
  662: ['Dirty water not increasing', 'wash', 'error'],
  663: ['Clean water level decreasing', 'wash', 'error'],
  664: ['Dirty water level decreasing', 'wash', 'error'],
  665: ['Pad wash hardware issue', 'wash', 'error'],
  668: ['No pad attached', 'wash', 'error'],
  669: ['Pad actuator stall', 'wash', 'error'],
  700: ['Unknown', 'dry', 'warn'],
  701: ['Ready', 'dry', 'ok'],
  702: ['Drying pads', 'dry', 'busy'],
  703: ['Pads dried', 'dry', 'ok'],
  704: ['Drying interrupted by robot', 'dry', 'warn'],
  705: ['Drying interrupted by mission', 'dry', 'warn'],
  706: ['Drying stopped by user', 'dry', 'ok'],
  707: ['Dry unavailable (dock updating)', 'dry', 'warn'],
  749: ['Invalid dock state', 'dry', 'error'],
  750: ['Dryer motor stall', 'dry', 'error'],
  751: ['Dryer motor failed to start', 'dry', 'error'],
  752: ['Dryer actuator stall', 'dry', 'error'],
  753: ['Pad not washed', 'dry', 'warn'],
  754: ['Dryer motor fault', 'dry', 'error'],
  755: ['Pad dry hardware issue', 'dry', 'error'],
  756: ['No pad attached', 'dry', 'error'],
  757: ['Pad dry communication failure', 'dry', 'error'],
};

export function dockStateInfo(code: number | null | undefined): DockStateInfo | null {
  if (code == null) return null;
  const row = TABLE[code];
  if (!row) {
    const kind = code >= 700 ? 'dry' : code >= 600 ? 'wash' : code >= 400 ? 'refill' : code >= 300 ? 'evac' : 'other';
    return { code, label: `Code ${code}`, kind, severity: code % 100 >= 49 ? 'error' : 'warn' };
  }
  return { code, label: row[0], kind: row[1], severity: row[2] };
}

export function isDockBusy(code: number | null | undefined): boolean {
  return dockStateInfo(code)?.severity === 'busy';
}
