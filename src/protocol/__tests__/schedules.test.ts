import { describe, expect, it } from 'vitest';

import {
  createSchedulesBody,
  daysLabel,
  householdIdForRobot,
  nextOccurrence,
  parseHouseholds,
  parseSchedules,
  patchSchedule,
  updateSchedulesBody,
} from '../models/schedules';

const household = {
  household_id: 'HH1',
  household_name: '#AUTO_GENERATED_HOUSEHOLD#',
  household_robots: [{ robot_id: 'ROBOT32', household_id: 'HH1' }],
};

const payload = {
  household_schedules: [
    {
      household_schedule_id: 'CONT1',
      schedules: [
        {
          schedule_id: 'S1',
          options: {
            name: 'Weekday 9am',
            enabled: true,
            frequency: 'WEEKLY',
            robot_id: 'BLID',
            is_smart_clean_fav: false,
            start: { day: [1, 2, 3, 4, 5], hour: 9, min: 0 },
            commands: [{ command: { command: 'start', select_all: true, robot_id: 'BLID' } }],
          },
        },
        {
          schedule_id: 'S2',
          options: {
            name: 'Gone',
            deleted: true,
            enabled: false,
            start: { day: [6], hour: 10, min: 0 },
          },
        },
      ],
    },
  ],
};

describe('schedules', () => {
  it('unwraps a single household, a list, or {households}', () => {
    expect(parseHouseholds(household)).toHaveLength(1);
    expect(parseHouseholds({ households: [household] })[0].household_id).toBe('HH1');
    expect(parseHouseholds({ household: [household] })[0].robot_ids).toEqual(['ROBOT32']);
  });

  it('matches household by login robot_id, not only the BLID', () => {
    const other = { household_id: 'HH2', household_robots: [{ robot_id: 'OTHER' }] };
    const list = parseHouseholds({ households: [other, household] });
    expect(householdIdForRobot(list, ['ROBOT32'])).toBe('HH1');
    expect(householdIdForRobot(list, ['BLID', 'ROBOT32'])).toBe('HH1');
    expect(householdIdForRobot(list, ['UNKNOWN'])).toBeNull();
    expect(householdIdForRobot(parseHouseholds({ households: [household] }), ['UNKNOWN'])).toBe('HH1');
  });

  it('parses containers, unwraps commands, and drops deleted', () => {
    const items = parseSchedules(payload, 'HH1');
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Weekday 9am');
    expect(items[0].days).toEqual([1, 2, 3, 4, 5]);
    expect(items[0].hour).toBe(9);
    expect(items[0].commands[0].select_all).toBe(true);
    expect(daysLabel(items[0].days)).toBe('Weekdays');
  });

  it('enable toggle is a full-replace write that keeps unknown fields', () => {
    const [s] = parseSchedules(payload, 'HH1');
    const off = patchSchedule(s, { enabled: false });
    const body = updateSchedulesBody([off]);
    const options = (body.schedules as { options: Record<string, unknown> }[])[0].options;
    expect(options.enabled).toBe(false);
    expect(options.is_smart_clean_fav).toBe(false);
    expect(options.name).toBe('Weekday 9am');
  });

  it('create body wraps options and commands, and omits schedule_id', () => {
    const body = createSchedulesBody([
      {
        robotId: 'BLID',
        name: 'Kitchen',
        days: [6],
        hour: 10,
        minute: 30,
        commands: [{ command: 'start', p2map_id: 'M', regions: [{ region_id: '12', type: 'rid' }] }],
      },
    ]);
    const entry = (body.schedules as { schedule_id?: unknown; options: Record<string, unknown> }[])[0];
    expect(entry.schedule_id).toBeUndefined();
    expect(entry.options.name).toBe('Kitchen');
    expect(entry.options.start).toEqual({ day: [6], hour: 10, min: 30 });
    expect(entry.options.commands).toEqual([
      { command: { command: 'start', p2map_id: 'M', regions: [{ region_id: '12', type: 'rid' }] } },
    ]);
  });

  it('uses Sunday=0 like Date.getDay, not Python weekday', () => {
    const [s] = parseSchedules(payload, 'HH1');
    const mondayNine = patchSchedule(s, { days: [1], hour: 9, minute: 0 });
    const from = new Date('2026-09-06T08:00:00'); // Sunday 08:00
    const next = nextOccurrence(mondayNine, from);
    expect(next?.getDay()).toBe(1);
    expect(next?.getHours()).toBe(9);
  });
});
