export const CONTRIBUTION_RULES = {
    baseCap: 10000,
    likePoints: 1,
    danmakuPoints: 20,
    pointsPerDiamond: 10000,
};

type Side = 'left' | 'right';
export type Contributor = {
    id: string;
    name: string;
    side: Side;
    baseScore: number;
    giftScore: number;
    giftDiamonds: number;
    score: number;
};
type ContributionEvent = {
    kind: string;
    openId?: string;
    uname?: string;
    likeCount?: number;
    giftNum?: number;
    price?: number;
    totalPrice?: number;
};

export class ContributionLedger {
    private players = new Map<string, Contributor>();
    private frozen = false;

    sideFor(id?: string): Side | undefined {
        return id ? this.players.get(id)?.side : undefined;
    }

    credit(event: ContributionEvent, side: Side): void {
        if (this.frozen || !event.openId || !['like', 'danmaku', 'gift'].includes(event.kind)) return;
        const player = this.players.get(event.openId) ?? { id: event.openId, name: event.uname || '观众', side, baseScore: 0, giftScore: 0, giftDiamonds: 0, score: 0 };
        let base = 0, diamonds = 0;
        if (event.kind === 'like') base = (event.likeCount ?? 1) * CONTRIBUTION_RULES.likePoints;
        if (event.kind === 'danmaku') base = CONTRIBUTION_RULES.danmakuPoints;
        if (event.kind === 'gift') diamonds = event.totalPrice ?? (event.price ?? 0) * (event.giftNum ?? 1);
        if (![base, diamonds].every(value => Number.isSafeInteger(value) && value >= 0)) return;
        const giftScore = player.giftScore + diamonds * CONTRIBUTION_RULES.pointsPerDiamond;
        const baseScore = Math.min(CONTRIBUTION_RULES.baseCap, player.baseScore + base);
        if (!Number.isSafeInteger(giftScore + baseScore)) return;
        Object.assign(player, { name: event.uname || player.name, baseScore, giftScore, giftDiamonds: player.giftDiamonds + diamonds, score: baseScore + giftScore });
        this.players.set(player.id, player);
    }

    ranking(): Contributor[] {
        return [...this.players.values()].sort((a, b) => b.score - a.score || b.giftScore - a.giftScore || a.id.localeCompare(b.id)).map(player => ({ ...player }));
    }

    freeze(): Contributor[] {
        this.frozen = true;
        return this.ranking();
    }
}
