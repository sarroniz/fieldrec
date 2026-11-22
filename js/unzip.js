// Minimal dependency-free ZIP reader ("store" and "deflate" methods).
// "deflate" uses DecompressionStream('deflate-raw'), available in Safari 16.4+ and Chrome 80+.
// openZip() reads only the central directory; each entry is decompressed when read(),
// so large files (a 100 MB .pptx) don't have to be expanded all at once.

export async function openZip(input) {
  const buf = new Uint8Array(input instanceof Blob ? await input.arrayBuffer() : input);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('The file is not a valid ZIP');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder('utf-8');
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The ZIP file is damaged');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = utf8.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    entries.push({
      name, size: usize,
      async read() {
        const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
        const raw = buf.subarray(start, start + csize);
        let data;
        if (method === 0) data = raw.slice();
        else if (method === 8) data = await inflateRaw(raw);
        else throw new Error(`“${name}” uses an unsupported compression method`);
        return data.buffer.byteLength === data.length ? data.buffer : data.slice().buffer;
      },
      async text() { return new TextDecoder('utf-8').decode(await this.read()); },
    });
  }
  return { entries, get: (n) => entries.find((e) => e.name === n) };
}

// Reads everything at once: [{ name, data: ArrayBuffer }]
export async function unzip(input) {
  const z = await openZip(input);
  const out = [];
  for (const e of z.entries) out.push({ name: e.name, data: await e.read() });
  return out;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser can’t decompress ZIP files. Update iPadOS or Safari.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
