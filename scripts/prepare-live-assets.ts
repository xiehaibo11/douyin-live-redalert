import { mkdir, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { MixFile } from '../src/data/MixFile';
import { MixEntry } from '../src/data/MixEntry';
import { DataStream } from '../src/data/DataStream';
import { Crc32 } from '../src/data/Crc32';
import { MapFile } from '../src/data/MapFile';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceUrl = 'https://download.ra2web.com/full-pack.7z';

export function packMix(entries: Iterable<[number, Uint8Array]>): Uint8Array {
    const files = [...new Map(entries)].sort(([a], [b]) => a - b);
    if (files.length > 65535) throw new Error('Too many MIX entries');
    const size = files.reduce((sum, [, bytes]) => sum + bytes.length, 0);
    const header = 10 + files.length * 12;
    const output = new Uint8Array(header + size);
    const view = new DataView(output.buffer);
    view.setUint32(0, 0, true);
    view.setUint16(4, files.length, true);
    view.setUint32(6, size, true);
    let offset = 0;
    files.forEach(([hash, bytes], index) => {
        view.setUint32(10 + index * 12, hash, true);
        view.setUint32(14 + index * 12, offset, true);
        view.setUint32(18 + index * 12, bytes.length, true);
        output.set(bytes, header + offset);
        offset += bytes.length;
    });
    return output;
}

export function makeTrainingMap(): string {
    const width = 40, height = 40;
    const data = new Uint8Array(11 * (2 * width - 1) * height + 4);
    const view = new DataView(data.buffer);
    let offset = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < 2 * width - 1; x++) {
            const dy = 2 * y + x % 2;
            const rx = (x + dy) / 2 + 1;
            view.setUint16(offset, rx, true);
            view.setUint16(offset + 2, dy - rx + width + 1, true);
            offset += 11;
        }
    }
    // Literal-only LZO blocks keep this original flat map reproducible without a compressor dependency.
    const blocks: Uint8Array[] = [];
    for (let start = 0; start < data.length; start += 200) {
        const chunk = data.subarray(start, start + 200);
        const block = new Uint8Array(chunk.length + 8);
        const header = new DataView(block.buffer);
        header.setUint16(0, chunk.length + 4, true);
        header.setUint16(2, chunk.length, true);
        block[4] = chunk.length + 17;
        block.set(chunk, 5);
        block.set([17, 0, 0], chunk.length + 5);
        blocks.push(block);
    }
    const encoded = Buffer.concat(blocks).toString('base64').match(/.{1,70}/g)!.map((line, index) => `${index + 1}=${line}`).join('\n');
    return `[Basic]\nName=Live Interaction Training\nNewINIFormat=4\nMultiplayerOnly=yes\n[Map]\nSize=0,0,40,40\nLocalSize=3,5,34,29\nTheater=TEMPERATE\n[Waypoints]\n0=43036\n1=36043\n[IsoMapPack5]\n${encoded}\n[Lighting]\nAmbient=1\nRed=1\nGreen=1\nBlue=1\n[SpecialFlags]\n[Structures]\n[Units]\n[Infantry]\n[Terrain]\n[Smudge]\n`;
}

export function makeLoadingPng(): Uint8Array {
    const width = 640, height = 360;
    const pixels = Buffer.alloc(height * (width * 3 + 1));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = y * (width * 3 + 1) + 1 + x * 3;
        const grid = x % 40 === 0 || y % 40 === 0 ? 8 : 0;
        pixels[offset] = 24 + Math.floor(24 * x / width) + grid;
        pixels[offset + 1] = 15 + grid;
        pixels[offset + 2] = 20 + grid;
    }
    const chunk = (type: string, data: Uint8Array) => {
        const output = Buffer.alloc(data.length + 12);
        output.writeUInt32BE(data.length, 0);
        output.write(type, 4, 4, 'ascii');
        output.set(data, 8);
        output.writeUInt32BE(Crc32.calculateCrc(output.subarray(4, output.length - 4)), output.length - 4);
        return output;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', new Uint8Array())]);
}

async function prepare() {
    const cache = join(root, '.artifacts/source');
    const output = join(root, 'public/cdn/game-res/v2');
    const maps = join(root, 'public/cdn/maps');
    await mkdir(cache, { recursive: true });
    await mkdir(output, { recursive: true });
    await mkdir(maps, { recursive: true });
    const source = resolve(process.argv[2] ?? join(cache, 'full-pack.7z'));
    if (!(await Bun.file(source).exists())) {
        if (process.argv[2]) throw new Error(`Source not found: ${source}`);
        console.log(`Downloading the upstream-configured asset archive: ${sourceUrl}`);
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error(`Asset download failed: HTTP ${response.status}`);
        await Bun.write(source + '.part', response);
        await rename(source + '.part', source);
    }
    const raw = join(cache, 'raw');
    await mkdir(raw, { recursive: true });
    if (process.argv[2] || !(await Bun.file(join(raw, 'RA2.MIX')).exists()) || !(await Bun.file(join(raw, 'LANGUAGE.MIX')).exists())) {
        const { default: createSevenZip } = await import('7z-wasm');
        const wasmBinary = new Uint8Array(await Bun.file(new URL('./7zz.wasm', import.meta.resolve('7z-wasm'))).arrayBuffer());
        const zip = await createSevenZip({ wasmBinary, print: () => {}, printErr: (line: string) => console.error(line) });
        zip.FS.writeFile('/source.7z', new Uint8Array(await Bun.file(source).arrayBuffer()));
        const result = zip.callMain(['x', '-y', '-o/raw', '/source.7z', 'RA2.MIX', 'LANGUAGE.MIX']);
        if (result) throw new Error(`Archive extraction failed: ${result}`);
        console.log('Extracted source archives:', zip.FS.readdir('/raw').join(', '));
        for (const name of ['RA2.MIX', 'LANGUAGE.MIX']) {
            try {
                // Archived permission bits can make extracted files unreadable in Emscripten.
                zip.FS.chmod('/raw/' + name, 0o600);
                await Bun.write(join(raw, name), zip.FS.readFile('/raw/' + name));
            }
            catch (error) { throw new Error(`Could not read extracted ${name}: ${(error as Error).message}`); }
        }
    }
    const readMix = async (path: string) => new MixFile(new DataStream(await Bun.file(path).arrayBuffer()));
    const ra2 = await readMix(join(raw, 'RA2.MIX'));
    const language = await readMix(join(raw, 'LANGUAGE.MIX'));
    const child = (name: string) => {
        const owner = ra2.containsFile(name) ? ra2 : language;
        return new MixFile(new DataStream(owner.openFile(name).getBytes()));
    };
    const merge = (...archives: MixFile[]) => {
        const entries = new Map<number, Uint8Array>();
        for (const archive of archives) for (const [hash, bytes] of archive.entries()) if (!entries.has(hash)) entries.set(hash, bytes);
        return packMix(entries);
    };
    const local = child('local.mix');
    // shortcut: UI and voxel packs share source entries; split them if browser memory becomes a bottleneck.
    const packs = new Map<string, Uint8Array>([
        ['ini.mix', merge(await readMix(join(root, 'public/ini.mix')), local)],
        ['ui.mix', merge(child('cache.mix'), local, child('load.mix'), child('conquer.mix'))],
        ['strings.mix', packMix([[MixEntry.hashFilename('ra2.csf'), language.openFile('ra2.csf').getBytes()]])],
        ['build-gen.mix', merge(child('generic.mix'), child('neutral.mix'), child('isogen.mix'))],
        ['anims.mix', ra2.openFile('conquer.mix').getBytes()],
        ['vxl.mix', ra2.openFile('local.mix').getBytes()],
    ]);
    for (const name of ['isotemp.mix', 'isosnow.mix', 'isourb.mix', 'temperat.mix', 'snow.mix', 'urban.mix', 'tem.mix', 'sno.mix', 'urb.mix', 'sidec01.mix', 'sidec02.mix', 'cameo.mix']) {
        const owner = ra2.containsFile(name) ? ra2 : language;
        packs.set(name, owner.openFile(name).getBytes());
    }
    const checksums: Record<string, number> = {};
    for (const [name, bytes] of packs) {
        await Bun.write(join(output, name + '.part'), bytes);
        await rename(join(output, name + '.part'), join(output, name));
        checksums[name] = Crc32.calculateCrc(bytes);
        console.log(`Prepared ${name}: ${(bytes.length / 1048576).toFixed(1)} MiB`);
    }
    const map = makeTrainingMap();
    const parsed = new MapFile(map);
    if (parsed.tiles.length !== 3160 || parsed.startingLocations.length !== 2) throw new Error('Generated map validation failed');
    await Bun.write(join(maps, '2_reconcile.map'), map);
    await mkdir(join(output, 'ls'), { recursive: true });
    const loading = makeLoadingPng();
    await Bun.write(join(output, 'glsl.png'), loading);
    await Bun.write(join(output, 'ls/ls800obs.png'), loading);
    await Bun.write(join(output, 'manifest.json'), JSON.stringify({ version: 2, format: 'mix', checksums, source: { url: sourceUrl, sha256: new Bun.CryptoHasher('sha256').update(await Bun.file(source).arrayBuffer()).digest('hex') }, map: 'Original generated flat training map; game art comes from the upstream archive.' }, null, 2));
    console.log(`Local CDN prepared: ${packs.size} MIX archives and one generated training map.`);
}

if (import.meta.main) await prepare();
