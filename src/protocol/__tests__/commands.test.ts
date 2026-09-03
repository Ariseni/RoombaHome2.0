import { describe, expect, it } from 'vitest';

import { buildParams, regionCommand, simpleCommand, supportedCleanModes } from '../commands';
import { dockStateInfo } from '../models/dock';
import { errorText } from '../models/errors';
import { parseLiveMapMessage } from '../models/livemap';
import { activityOf, emptyState, mergeReported } from '../models/shadow';

describe('commands', () => {
  it('simple command carries time and initiator', () => {
    const c = simpleCommand('find');
    expect(c.command).toBe('find');
    expect(c.initiator).toBe('localApp');
    expect(typeof c.time).toBe('number');
  });

  it('region command uses confirmed wire keys', () => {
    const c = regionCommand({
      blid: 'B1',
      p2mapId: 'M1',
      regions: [{ region_id: '12', type: 'rid', region_name: 'Kitchen' }],
      params: buildParams({ mode: 'vacuum_and_mop', suction: 3, wetness: 'wet', passes: 2 }),
    });
    expect(c.command).toBe('start');
    expect(c.robot_id).toBe('B1');
    expect(c.p2map_id).toBe('M1');
    expect(c.select_all).toBe(false);
    expect(c.regions).toEqual([{ region_id: '12', type: 'rid', region_name: 'Kitchen' }]);
    expect(c.params).toEqual({
      operatingMode: 32,
      suctionLevel: 3,
      padWetness: { disposable: 2, reusable: 2, padPlate: 3 },
      twoPass: true,
      noAutoPasses: false,
    });
    expect(c.initiator).toBe('localApp');
  });

  it('refuses regions without id', () => {
    expect(() => regionCommand({ blid: 'B', p2mapId: 'M', regions: [{ region_id: '', type: 'rid' }] })).toThrow();
  });

  it('derives supported modes from cap.oMode', () => {
    expect(supportedCleanModes(550)).toEqual(['vacuum', 'mop', 'vacuum_and_mop', 'vacuum_then_mop']);
    expect(supportedCleanModes(2)).toEqual(['vacuum']);
  });
});

describe('state', () => {
  it('merges partial reported fragments', () => {
    let s = emptyState();
    s = mergeReported(s, { batPct: 80, cleanMissionStatus: { cycle: 'none', phase: 'charge', error: 0 }, bin: { present: true } });
    s = mergeReported(s, { cleanMissionStatus: { phase: 'run', cycle: 'clean' } });
    expect(s.batPct).toBe(80);
    expect(s.binPresent).toBe(true);
    expect(s.mission.phase).toBe('run');
    expect(s.mission.error).toBe(0);
    expect(activityOf(s)).toBe('cleaning');
    s = mergeReported(s, { cleanMissionStatus: { error: 46 } });
    expect(activityOf(s)).toBe('error');
    expect(errorText(46, 'Rob')?.title.length).toBeGreaterThan(0);
    s = mergeReported(s, { dock: { state: 301, pwState: 602 } });
    expect(s.dock?.pwState).toBe(602);
    expect(dockStateInfo(602)?.label).toBe('Washing pads');
  });

  it('parses live map position updates', () => {
    const m = parseLiveMapMessage({ pos_update: { cur_path: [5, 1.0, 2.0, 0.5, 2, 1.5, 2.5, 0.6, 2, 1700000000] } });
    expect(m?.kind).toBe('position');
    if (m?.kind === 'position') {
      expect(m.sequence).toBe(5);
      expect(m.samples).toHaveLength(2);
      expect(m.samples[1]).toEqual({ x: 1.5, y: 2.5, theta: 0.6, operatingModes: 2 });
      expect(m.timestamp).toBe(1700000000);
    }
    expect(parseLiveMapMessage({ map_update: { livemap_url: 'https://x' } })?.kind).toBe('map');
  });
});
