import { describe, expect, it } from 'vitest';

import { favoriteRunPayloads, favoriteToJson, newFavoriteBody, parseFavorites, roomsSummary } from '../models/favorites';

const kitchen = {
  favorite_id: 'fav-1',
  name: 'Kitchen',
  color: '#ff8800',
  hidden: false,
  deleted: false,
  display_order: 2,
  commanddefs: [
    {
      command: 'start',
      robot_id: 'BLID',
      p2map_id: 'MAP',
      regions: [{ region_id: '12', type: 'rid', region_name: 'Kitchen' }],
    },
  ],
};

describe('favorites', () => {
  it('unwraps list or {favorites} and drops hidden/deleted', () => {
    expect(parseFavorites({ favorites: [kitchen, { ...kitchen, favorite_id: 'x', hidden: true }] })).toHaveLength(1);
    expect(parseFavorites([kitchen])).toHaveLength(1);
    expect(parseFavorites([{ favorite_id: 'gone', deleted: true, name: 'x' }])).toHaveLength(0);
  });

  it('sorts by display_order', () => {
    const later = { ...kitchen, favorite_id: 'b', display_order: 9, name: 'Later' };
    const first = { ...kitchen, favorite_id: 'a', display_order: 1, name: 'First' };
    expect(parseFavorites([later, first]).map((f) => f.name)).toEqual(['First', 'Kitchen', 'Later']);
  });

  it('adds initiator and time when running — stored defs have neither', () => {
    const [fav] = parseFavorites([kitchen]);
    const [payload] = favoriteRunPayloads(fav, 'BLID');
    expect(payload.initiator).toBe('localApp');
    expect(typeof payload.time).toBe('number');
    expect(payload.command).toBe('start');
    expect(payload.favorite_id).toBe('fav-1');
    expect(payload.p2map_id).toBe('MAP');
    expect(payload.regions).toEqual([{ region_id: '12', type: 'rid', region_name: 'Kitchen' }]);
  });

  it('falls back to start + favorite_id when commanddefs is empty', () => {
    const [fav] = parseFavorites([{ favorite_id: 'z', name: 'Whole', commanddefs: [] }]);
    const [payload] = favoriteRunPayloads(fav, 'B');
    expect(payload.command).toBe('start');
    expect(payload.favorite_id).toBe('z');
    expect(payload.initiator).toBe('localApp');
    expect(roomsSummary(fav)).toBe('Whole house');
  });

  it('serializes create/update bodies with commanddefs (not command_defs)', () => {
    const body = newFavoriteBody({
      name: 'Kitchen',
      commanddefs: [{ command: 'start', p2map_id: 'M', regions: [{ region_id: '1', type: 'rid' }] }],
    });
    expect(body.commanddefs).toBeTruthy();
    expect(body.command_defs).toBeUndefined();
    expect(body.hidden).toBe(false);

    const [fav] = parseFavorites([kitchen]);
    const updated = favoriteToJson({ ...fav, name: 'Kitchen nightly' });
    expect(updated.name).toBe('Kitchen nightly');
    expect(updated.commanddefs).toHaveLength(1);
  });
});
