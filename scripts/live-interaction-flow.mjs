import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createLiveRuntime } from './live-interaction-runtime.mjs';

const output = resolve('.artifacts/live-interaction');
await mkdir(output, { recursive: true });
const executablePath = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(path => path && existsSync(path));
const runtime = createLiveRuntime(0);
let browser;
const errors = [];
const report = {};
try {
    browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
    page.on('pageerror', error => errors.push(error.stack));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    try {
        await page.goto(new URL('/#/liveinteraction', runtime.server.url).href);
        await page.waitForFunction(() => window.__ra2debug?.liveInteraction?.snapshot().ready, null, { timeout: 90000 });
        const snapshot = () => page.evaluate(() => window.__ra2debug.liveInteraction.snapshot());
        report.initial = await snapshot();
        assert.equal(report.initial.layout.windowViewport.width, 540);
        assert.equal(report.initial.layout.windowViewport.height, 960);
        assert.deepEqual(report.initial.contributions, []);
        const basePositions = await page.evaluate(() => {
            const battle = window.__ra2debug.liveInteractionBattle;
            const camera = battle.worldScene.camera;
            return [battle.leftBase, battle.rightBase].map(base => {
                const point = camera.position.clone().copy(base.position.worldPosition).project(camera);
                return { x: point.x, y: point.y };
            });
        });
        assert.ok(basePositions[0].x < basePositions[1].x, 'Red and blue bases must appear left and right');
        assert.ok(Math.abs((basePositions[0].y + basePositions[1].y) / 2) < 0.35, 'Initial camera must center the battlefield');
        const roundId = report.initial.round.id;
        await page.evaluate(() => window.__ra2debug.liveInteraction.emitMock('like', { uname: '红方测试观众', openId: 'red-viewer', likeCount: 3 }));
        await page.waitForFunction(() => window.__ra2debug.liveInteraction.snapshot().left.totalSpawned === 3);
        await page.evaluate(() => window.__ra2debug.liveInteraction.emitMock('gift', { uname: '蓝方测试观众', openId: 'blue-viewer', giftName: '测试礼物', giftNum: 1, totalPrice: 2000 }));
        await page.waitForFunction(() => window.__ra2debug.liveInteraction.snapshot().right.totalSpawned === 8);
        report.spawned = await snapshot();
        assert.equal(report.spawned.contributions[0].id, 'blue-viewer');
        assert.equal(report.spawned.contributions[0].giftScore, 20000000);
        assert.equal(report.spawned.contributions.find(player => player.id === 'red-viewer').baseScore, 3);
        await page.screenshot({ path: resolve(output, 'battle.png') });
        for (let batch = 0; batch < 30 && (await snapshot()).round.phase === 'running'; batch++) {
            await page.evaluate(() => window.__ra2debug.liveInteraction.advanceTicks(600));
        }
        report.settled = await snapshot();
        assert.equal(report.settled.round.phase, 'settling', 'Generated units must win a real battle by destroying a base');
        assert.ok(!report.settled.left.baseHealth.isAlive || !report.settled.right.baseHealth.isAlive);
        assert.equal(await page.locator('[data-live-settlement]').isVisible(), true);
        assert.ok(Number(await page.locator('[data-live-countdown]').innerText()) >= 9, 'Settlement starts with ten seconds');
        await page.screenshot({ path: resolve(output, 'settlement.png') });
        await page.evaluate(() => window.__ra2debug.liveInteraction.emitMock('like', { uname: '结算期间测试', likeCount: 5 }));
        await page.waitForTimeout(300);
        assert.equal((await snapshot()).left.totalSpawned, report.settled.left.totalSpawned, 'Settlement must reject reinforcements');
        assert.deepEqual((await snapshot()).contributions, report.settled.contributions, 'Settlement contributions must remain frozen');
        await page.waitForFunction(id => {
            const state = window.__ra2debug?.liveInteraction?.snapshot();
            return state?.ready && state.round.id === id + 1;
        }, roundId, { timeout: 30000 });
        report.nextRound = await snapshot();
        assert.equal(report.nextRound.round.phase, 'running');
        assert.equal(report.nextRound.left.totalSpawned, 0);
        assert.equal(report.nextRound.right.totalSpawned, 0);
        assert.equal(report.nextRound.left.unitsLost, 0);
        assert.equal(report.nextRound.right.unitsLost, 0);
        assert.equal(report.nextRound.left.baseHealth.hpDisplay, '100/100');
        assert.equal(report.nextRound.right.baseHealth.hpDisplay, '100/100');
        assert.deepEqual(report.nextRound.contributions, []);
        assert.equal(await page.locator('[data-live-settlement]').isVisible(), false);
        await page.evaluate(() => window.__ra2debug.liveInteraction.emitMock('like', { uname: '新一局测试', openId: 'next-viewer', likeCount: 1 }));
        await page.waitForFunction(() => window.__ra2debug.liveInteraction.snapshot().left.totalSpawned === 1);
        assert.equal((await snapshot()).left.aliveUnits, 1, 'Reopening must not duplicate SSE listeners');
        await page.evaluate(() => window.__ra2debug.liveInteraction.emitMock('danmaku', { uname: '新一局测试', openId: 'next-viewer', message: '红军 加油' }));
        await page.waitForFunction(() => window.__ra2debug.liveInteraction.snapshot().contributions[0]?.score === 21);
        await page.screenshot({ path: resolve(output, 'next-round.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => window.__ra2debug.liveInteraction.snapshot().layout.windowViewport.width === 390);
        const bounds = await page.locator('[data-live-broadcast]').boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, 'Portrait HUD must not be horizontally clipped');
        await page.screenshot({ path: resolve(output, 'portrait-390.png') });
        assert.deepEqual(errors, [], 'Browser must load all resources without runtime errors');
        report.passed = true;
    } catch (error) {
        await page.screenshot({ path: resolve(output, 'failure.png') });
        report.failure = error.stack;
        report.text = await page.locator('body').innerText();
        throw error;
    }
} finally {
    report.errors = errors;
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser?.close();
    await runtime.stop();
}
console.log(`Live battle, settlement and automatic restart verified. Report: ${output}`);
