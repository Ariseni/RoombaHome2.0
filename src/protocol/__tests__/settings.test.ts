import { describe, expect, it } from 'vitest';

import { clockLabel, dndDailyBody, evacFreqOptions, parseDnd, parseRobotSettings } from '../models/settings';

describe('robot settings', () => {
  it('reads nested audio.volume and camelCase flags from rw-settings reported', () => {
    const s = parseRobotSettings({
      childLock: true,
      audio: { volume: 6 },
      ecoCharge: false,
      pwReturn: 2,
      pwAreaInterval: 10,
      padWashAllowed: 1,
    });
    expect(s.childLock).toBe(true);
    expect(s.volume).toBe(6);
    expect(s.ecoCharge).toBe(false);
    expect(s.padWashReturn).toBe(2);
    expect(s.padWashArea).toBe(10);
    expect(s.padWashAllowed).toBe(true);
  });

  it('also accepts the dotted write-key on read-back', () => {
    expect(parseRobotSettings({ 'audio.volume': 3 }).volume).toBe(3);
  });

  it('builds DND daily body as minutes since midnight, never both variants', () => {
    const body = dndDailyBody(22, 0, 7, 30);
    expect(body).toEqual({ dailyStart: 1320, dailyEnd: 450 });
    expect(body.endsAt).toBeUndefined();
    expect(clockLabel(1320)).toBe('22:00');
    expect(parseDnd({ dailyStart: 1320, dailyEnd: 450 }).dailyStart).toBe(1320);
  });

  it('limits auto-evac choices from cap.autoevac', () => {
    expect(evacFreqOptions(1).map((o) => o.value)).toEqual([0, 1, 2]);
    expect(evacFreqOptions(2).map((o) => o.value)).toEqual([0, 15, 25]);
    expect(evacFreqOptions(0)).toEqual([]);
  });
});
