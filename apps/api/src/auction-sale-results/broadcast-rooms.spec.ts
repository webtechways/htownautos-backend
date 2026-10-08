import { copartBroadcastRooms } from './broadcast-rooms.service';

describe('copartBroadcastRooms', () => {
  it('con lanes en el calendario, esas', () => {
    expect(copartBroadcastRooms(25, { lanes: [{ lane: 'A' }, { lane: 'B' }] })).toEqual(['copart-25-a', 'copart-25-b']);
  });

  it('junta lanes, liveLanes y laterLanes sin repetir', () => {
    expect(copartBroadcastRooms(5, { lanes: [{ lane: 'A' }], liveLanes: [{ lane: 'A' }, { lane: 'C' }], laterLanes: [] })).toEqual(['copart-5-a', 'copart-5-c']);
  });

  it('sin lanes todavia (upcoming), las candidatas A-E', () => {
    // Caso real: NCS Central Region (881) en vivo a las 20:00 con lanes: []
    expect(copartBroadcastRooms(881, { lanes: [], liveLanes: [], laterLanes: [] })).toEqual([
      'copart-881-a', 'copart-881-b', 'copart-881-c', 'copart-881-d', 'copart-881-e',
    ]);
    expect(copartBroadcastRooms(881, null)).toHaveLength(5);
  });
});
