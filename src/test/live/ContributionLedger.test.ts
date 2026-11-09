import { expect, test } from 'bun:test';
import { ContributionLedger } from '../../game/live/ContributionLedger';
import { armyFocus } from '../../game/live/BroadcastCamera';

test('base contribution caps per viewer while gift contribution continues to grow', () => {
    const ledger = new ContributionLedger();
    ledger.credit({ kind: 'like', openId: 'free', uname: '同名', likeCount: 50000 }, 'left');
    ledger.credit({ kind: 'danmaku', openId: 'free' }, 'left');
    ledger.credit({ kind: 'gift', openId: 'paid', uname: '同名', price: 1, giftNum: 2 }, 'right');
    expect(ledger.ranking().map(player => [player.id, player.score])).toEqual([['paid', 20000], ['free', 10000]]);
    ledger.credit({ kind: 'gift', openId: 'paid', totalPrice: 3 }, 'left');
    expect(ledger.ranking()[0].giftScore).toBe(50000);
    expect(ledger.sideFor('paid')).toBe('right');
});

test('settlement freezes the board and rejects invalid or unidentified contributions', () => {
    const ledger = new ContributionLedger();
    ledger.credit({ kind: 'gift', totalPrice: 9 }, 'left');
    ledger.credit({ kind: 'gift', openId: 'invalid', totalPrice: -1 }, 'left');
    expect(ledger.ranking()).toEqual([]);
    ledger.credit({ kind: 'danmaku', openId: 'viewer' }, 'left');
    const frozen = ledger.freeze();
    ledger.credit({ kind: 'gift', openId: 'viewer', totalPrice: 100 }, 'left');
    expect(ledger.ranking()).toEqual(frozen);
    frozen[0].score = 0;
    expect(ledger.ranking()[0].score).toBe(20);
    expect(new ContributionLedger().ranking()).toEqual([]);
});

test('army focus follows the side with more living units and handles empty battles', () => {
    const left = { x: 0, y: 20 }, right = { x: 100, y: 20 };
    expect(armyFocus([], [], { x: 50, y: 20 })).toEqual({ x: 50, y: 20 });
    expect(armyFocus([left, left, left], [right], left).x).toBe(25);
    expect(armyFocus([left], [right, right, right], right).x).toBe(75);
});
