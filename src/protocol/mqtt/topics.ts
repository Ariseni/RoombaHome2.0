/**
 * Topic builders. Never subscribe to broad wildcards (`shadow/#`, `#`):
 * the authorizer's policy answers with an immediate disconnect.
 */

export type NamedShadow =
  | 'ro-currentstate'
  | 'ro-stats'
  | 'ro-configinfo'
  | 'ro-services'
  | 'rw-settings'
  | 'rw-software'
  | 'rw-schedule'
  | 'rw-constatus';

export function shadowBase(blid: string, named?: string | null): string {
  return named ? `$aws/things/${blid}/shadow/name/${named}` : `$aws/things/${blid}/shadow`;
}

export const shadowTopics = {
  get: (blid: string, named?: string | null) => `${shadowBase(blid, named)}/get`,
  getAccepted: (blid: string, named?: string | null) => `${shadowBase(blid, named)}/get/accepted`,
  getRejected: (blid: string, named?: string | null) => `${shadowBase(blid, named)}/get/rejected`,
  update: (blid: string, named?: string | null) => `${shadowBase(blid, named)}/update`,
  updateAccepted: (blid: string, named?: string | null) => `${shadowBase(blid, named)}/update/accepted`,
  updateRejected: (blid: string, named?: string | null) => `${shadowBase(blid, named)}/update/rejected`,
  updateDelta: (blid: string, named?: string | null) => `${shadowBase(blid, named)}/update/delta`,
  updateDocuments: (blid: string, named?: string | null) => `${shadowBase(blid, named)}/update/documents`,
};

export function thingBase(prefix: string, blid: string): string {
  return `${prefix}/things/${blid}`;
}

export const irbtTopics = {
  cmd: (prefix: string, blid: string) => `${thingBase(prefix, blid)}/cmd`,
  livemapUpdate: (prefix: string, blid: string) => `${thingBase(prefix, blid)}/livemap/update`,
  missionTimelineReport: (prefix: string, blid: string) => `${thingBase(prefix, blid)}/mission/timeline/report`,
  missionTimelineRequest: (prefix: string, blid: string) => `${thingBase(prefix, blid)}/mission/timeline/request`,
  rejectedReport: (prefix: string, blid: string) => `${thingBase(prefix, blid)}/rejected/report`,
  /** Bin evacuation report sits one level up from the other dock reports. */
  evacReport: (prefix: string, blid: string) => `${thingBase(prefix, blid)}/evac/report`,
  dockReport: (prefix: string, blid: string, kind: 'refill' | 'padwash' | 'paddry') =>
    `${thingBase(prefix, blid)}/dock/${kind}/report`,
};

export function allDockReportTopics(prefix: string, blid: string): string[] {
  return [
    irbtTopics.evacReport(prefix, blid),
    irbtTopics.dockReport(prefix, blid, 'refill'),
    irbtTopics.dockReport(prefix, blid, 'padwash'),
    irbtTopics.dockReport(prefix, blid, 'paddry'),
  ];
}
