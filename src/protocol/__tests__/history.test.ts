import { describe, expect, it } from 'vitest';

import { highlightCoverage, historyAreaM2, historyRooms, parseMissionHistory } from '../models/history';

const sample = [
  {
    missionId: 'm-1',
    nMssn: 42,
    robot_id: 'BLID',
    startTime: 1756900000,
    timestamp: 1756903600,
    durationM: 40,
    runM: 28,
    pauseM: 2,
    chrgM: 10,
    done: 'ok',
    done_raw: 'ok',
    sqft: 215,
    evacs: 1,
    cmd: {
      command: 'start',
      initiator: 'localApp',
      p2map_id: 'MAP',
      user_p2mapv_id: 'VER',
      regions: [{ region_id: '12', type: 'rid', region_name: 'Kitchen' }],
    },
    timeline: {
      finEvents: [
        { room: { rid: '12', coverage: 0.92, status: 0, area: 120, totalArea: 110 } },
        { travel: { dest: 'dock' } },
      ],
    },
  },
  {
    missionId: 'm-2',
    startTime: 1756800000,
    done: 'usrEnd',
    runM: 5,
    sqft: 20,
    cmd: { command: 'start', cleanAll: true },
  },
];

describe('mission history', () => {
  it('parses a bare array with abbreviated wire keys', () => {
    const items = parseMissionHistory(sample);
    expect(items).toHaveLength(2);
    expect(items[0].missionId).toBe('m-1');
    expect(items[0].runM).toBe(28);
    expect(items[0].doneLabel).toBe('Finished');
    expect(items[0].command?.p2mapId).toBe('MAP');
    expect(items[0].command?.regions[0].name).toBe('Kitchen');
    expect(items[0].visits[0]).toMatchObject({ region_id: '12', coverage: 0.92, statusLabel: 'Finished' });
    expect(items[1].doneLabel).toBe('Stopped');
    expect(historyRooms(items[0])).toBe('Kitchen');
    expect(historyRooms(items[1])).toBe('Whole house');
    expect(historyAreaM2(215)).toBe('20 m²');
  });

  it('also unwraps {missions} and drops junk', () => {
    expect(parseMissionHistory({ missions: sample })).toHaveLength(2);
    expect(parseMissionHistory({ history: [] })).toHaveLength(0);
  });

  it('builds map highlights from command regions and visit coverage', () => {
    const [e] = parseMissionHistory(sample);
    expect(highlightCoverage(e)).toEqual([{ id: '12', coverage: 0.92 }]);
  });
});
