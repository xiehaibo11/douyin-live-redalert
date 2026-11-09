import { expect, test } from 'bun:test';
import { LiveRound } from '../../game/live/LiveRound';

test('one settlement per round, frozen result, then a clean next round', () => {
    const round = new LiveRound();
    expect(round.observe(false, true, 0)).toBe(false);
    round.start(1000);
    expect(round.observe(true, true, 1500)).toBe(false);
    expect(round.observe(true, false, 2000)).toBe(true);
    expect(round.winner).toBe('left');
    expect(round.restartAt).toBe(12000);
    expect(round.observe(false, false, 3000)).toBe(false);
    expect(round.winner).toBe('left');
    round.start(12000);
    expect(round.id).toBe(2);
    expect(round.phase).toBe('running');
    expect(round.winner).toBeUndefined();
    expect(round.restartAt).toBe(0);
    expect(round.observe(false, false, 13000)).toBe(true);
    expect(round.winner).toBe('draw');
});
