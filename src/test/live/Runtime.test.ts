import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createLiveRuntime } from '../../../scripts/live-interaction-runtime.mjs';

let runtime: ReturnType<typeof createLiveRuntime>;
let base: URL;
beforeEach(() => { runtime = createLiveRuntime(0); base = runtime.server.url; });
afterEach(() => runtime.stop());
const post = (route: string, body: unknown) => fetch(new URL(`/api/live-interaction/${route}`, base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('valid mock events reach SSE exactly once with identity and status', async () => {
    const controller = new AbortController();
    const stream = await fetch(new URL('/api/live-interaction/events', base), { signal: controller.signal });
    const reader = stream.body!.getReader();
    try {
        const decoder = new TextDecoder();
        expect(decoder.decode((await reader.read()).value)).toContain('event: status');
        const response = await post('mock', { kind: 'danmaku', uname: '同名观众', openId: '9007199254740993', message: '红军 坦克' });
        expect(response.status).toBe(200);
        expect((await response.json()).eventCount).toBe(1);
        let text = '';
        while (!text.includes('event: interaction')) text += decoder.decode((await reader.read()).value);
        const event = JSON.parse(text.split('event: interaction\ndata: ')[1].split('\n\n')[0]);
        expect(event.openId).toBe('9007199254740993');
        expect(event.message).toBe('红军 坦克');
        expect(event.id).toBeString();
    } finally { controller.abort(); await reader.cancel().catch(() => {}); }
});

test('rejects malformed input without counting or publishing it', async () => {
    for (const body of [{ kind: 'unknown' }, { kind: 'gift', giftNum: -1 }, { kind: 'like', likeCount: '10' }, { kind: 'danmaku', message: {} }, []]) {
        expect((await post('mock', body)).status).toBe(400);
    }
    expect((await (await fetch(new URL('/api/live-interaction/status', base))).json()).eventCount).toBe(0);
});

test('disconnect stops events and reconnect resumes the mock session', async () => {
    expect((await post('disconnect', {})).status).toBe(200);
    expect((await post('mock', { kind: 'like' })).status).toBe(409);
    expect((await post('connect', { mode: 'live' })).status).toBe(400);
    expect((await post('connect', { mode: 'mock' })).status).toBe(200);
    expect((await post('mock', { kind: 'like', likeCount: 3 })).status).toBe(200);
});

test('unknown resources and untrusted origins do not receive the app shell', async () => {
    expect((await fetch(new URL('/api/live-interaction/missing', base))).status).toBe(404);
    expect((await fetch(new URL('/cdn/missing.mix', base))).status).toBe(404);
    expect((await fetch(new URL('/api/live-interaction/mock', base), { method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: '{}' })).status).toBe(403);
});
