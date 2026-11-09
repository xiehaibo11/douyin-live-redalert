import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const prefix = '/api/live-interaction/';
const kinds = new Set(['room-enter', 'like', 'gift', 'guard', 'super-chat', 'danmaku', 'live-start', 'live-end']);
const isolationHeaders = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
};

export function createLiveRuntime(port = 4189) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid runtime port');
    const clients = new Set();
    const encoder = new TextEncoder();
    const status = { mode: 'mock', connected: true, connecting: false, sessionActive: false, eventCount: 0, lastError: null, lastEventAt: null, anchor: null };
    const json = (data, code = 200) => Response.json(data, { status: code, headers: isolationHeaders });
    const send = (client, event, data) => client.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    const broadcast = (event, data) => {
        for (const client of clients) {
            try { send(client, event, data); } catch { clients.delete(client); }
        }
    };
    const server = Bun.serve({
        hostname: '127.0.0.1', port, maxRequestBodySize: 16 * 1024,
        async fetch(request, server) {
            const url = new URL(request.url);
            if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return json({ error: 'Local connections only' }, 403);
            const origin = request.headers.get('origin');
            if (origin && ![url.origin, 'https://127.0.0.1:4000', 'https://localhost:4000'].includes(origin)) return json({ error: 'Origin rejected' }, 403);
            if (url.pathname.startsWith(prefix)) {
                const route = url.pathname.slice(prefix.length);
                if (route === 'status' && request.method === 'GET') return json(status);
                if (route === 'events' && request.method === 'GET') {
                    server.timeout(request, 0);
                    let controller;
                    const stream = new ReadableStream({
                        start(value) { controller = value; clients.add(value); send(value, 'status', status); },
                        cancel() { clients.delete(controller); },
                    });
                    return new Response(stream, { headers: { ...isolationHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
                }
                if (!['connect', 'disconnect', 'mock'].includes(route)) return json({ error: 'Unknown live endpoint' }, 404);
                if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
                let body;
                try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
                if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'JSON object required' }, 400);
                if (route === 'disconnect') {
                    status.connected = status.sessionActive = false;
                } else if (route === 'connect') {
                    if (body.mode !== 'mock') return json({ error: '本阶段提供本地模拟；抖音采集接入尚未启用。' }, 400);
                    status.connected = status.sessionActive = true;
                } else {
                    if (!status.connected) return json({ error: '请先连接本地模拟模式。' }, 409);
                    if (!kinds.has(body.kind)) return json({ error: 'Unsupported interaction kind' }, 400);
                    const event = { id: crypto.randomUUID(), kind: body.kind, cmd: body.kind, timestamp: Date.now() };
                    for (const key of ['uname', 'openId', 'message', 'giftName']) {
                        if (body[key] !== undefined) {
                            if (typeof body[key] !== 'string' || body[key].length > 500) return json({ error: `Invalid ${key}` }, 400);
                            event[key] = body[key];
                        }
                    }
                    for (const key of ['giftNum', 'price', 'totalPrice', 'likeCount', 'guardLevel']) {
                        if (body[key] !== undefined) {
                            if (!Number.isSafeInteger(body[key]) || body[key] < 0 || body[key] > 1000000) return json({ error: `Invalid ${key}` }, 400);
                            event[key] = body[key];
                        }
                    }
                    // shortcut: mock profiles use their names as IDs; require upstream IDs before enabling real collection.
                    event.openId ||= `mock:${event.uname || '测试观众'}`;
                    status.sessionActive = true;
                    status.eventCount++;
                    status.lastEventAt = event.timestamp;
                    broadcast('interaction', event);
                }
                broadcast('status', status);
                return json(status);
            }
            if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
            let path;
            try { path = decodeURIComponent(url.pathname); } catch { return json({ error: 'Invalid path' }, 400); }
            const filename = resolve(dist, '.' + (path === '/' ? '/index.html' : path));
            const local = relative(dist, filename);
            if (local.startsWith('..') || isAbsolute(local) || path.includes('\0')) return json({ error: 'Invalid path' }, 400);
            const file = Bun.file(filename);
            if (!(await file.exists())) return json({ error: path === '/' ? '请先运行 bun run build。' : 'File not found' }, 404);
            return new Response(request.method === 'HEAD' ? null : file, { headers: { ...isolationHeaders, 'Content-Type': file.type } });
        },
        error(error) {
            console.error('[live-runtime]', error.message);
            return json({ error: 'Runtime request failed' }, 500);
        },
    });
    const heartbeat = setInterval(() => {
        for (const client of clients) {
            try { client.enqueue(encoder.encode(': keepalive\n\n')); } catch { clients.delete(client); }
        }
    }, 15000);
    heartbeat.unref();
    return {
        server,
        stop() {
            clearInterval(heartbeat);
            for (const client of clients) { try { client.close(); } catch {} }
            clients.clear();
            return server.stop(true);
        },
    };
}

if (import.meta.main) {
    const runtime = createLiveRuntime(Number(process.env.PORT ?? 4189));
    console.log(`直播模拟运行时：${runtime.server.url}#/liveinteraction`);
    process.on('SIGINT', () => { runtime.stop(); process.exit(0); });
    process.on('SIGTERM', () => { runtime.stop(); process.exit(0); });
}
