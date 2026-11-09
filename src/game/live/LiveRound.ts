export type RoundWinner = 'left' | 'right' | 'draw';

export class LiveRound {
    id = 0;
    phase: 'loading' | 'running' | 'settling' = 'loading';
    winner?: RoundWinner;
    startedAt = 0;
    restartAt = 0;

    start(now: number): void {
        this.id++;
        this.phase = 'running';
        this.winner = undefined;
        this.startedAt = now;
        this.restartAt = 0;
    }

    observe(leftAlive: boolean, rightAlive: boolean, now: number): boolean {
        if (this.phase !== 'running' || (leftAlive && rightAlive)) return false;
        this.phase = 'settling';
        this.winner = leftAlive ? 'left' : rightAlive ? 'right' : 'draw';
        this.restartAt = now + 10000;
        return true;
    }
}
