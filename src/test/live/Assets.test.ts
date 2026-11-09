import { expect, test } from 'bun:test';
import { makeLoadingPng, makeTrainingMap, packMix } from '../../../scripts/prepare-live-assets';
import { inflateSync } from 'node:zlib';
import { MapFile } from '../../data/MapFile';
import { MixFile } from '../../data/MixFile';
import { MixEntry } from '../../data/MixEntry';
import { DataStream } from '../../data/DataStream';

test('generated MIX entries round-trip through the real archive reader', () => {
    const bytes = new TextEncoder().encode('generated data');
    const packed = packMix([[MixEntry.hashFilename('test.ini'), bytes]]);
    const archive = new MixFile(new DataStream(packed));
    expect(archive.containsFile('test.ini')).toBe(true);
    expect(archive.openFile('test.ini').getBytes()).toEqual(bytes);
    expect([...archive.entries()][0][1]).toEqual(bytes);
});

test('generated map decodes all tiles and has two usable starting positions', () => {
    const map = new MapFile(makeTrainingMap());
    expect(map.tiles).toHaveLength(3160);
    expect(map.startingLocations).toHaveLength(2);
    const starts = map.startingLocations.map(start => map.tiles.find(tile => tile.rx === start.x && tile.ry === start.y)!);
    expect(starts[0].dx).toBeLessThan(starts[1].dx);
    expect(starts[0].dy).toBe(starts[1].dy);
    for (const start of map.startingLocations) {
        expect(map.tiles.some(tile => tile.rx === start.x && tile.ry === start.y)).toBe(true);
    }
    expect(map.tiles.every(tile => tile.z === 0 && tile.tileNum === 0)).toBe(true);
});

test('generated loading image contains decodable PNG pixel data', () => {
    const png = Buffer.from(makeLoadingPng());
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(640);
    expect(png.readUInt32BE(20)).toBe(360);
    const length = png.readUInt32BE(33);
    expect(inflateSync(png.subarray(41, 41 + length))).toHaveLength(360 * (640 * 3 + 1));
});
