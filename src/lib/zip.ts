/**
 * Minimal, dependency-free ZIP writer (STORE method) — perfect for CBZ:
 * images are already compressed, so skipping deflate means zero CPU overhead
 * and bit-exact page quality. Streams straight to the HTTP response.
 */
import { PassThrough } from "node:stream";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

interface Entry {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export class ZipWriter {
  private out = new PassThrough();
  private entries: Entry[] = [];
  private written = 0;
  private closed = false;

  get stream(): PassThrough {
    return this.out;
  }

  get byteLength(): number {
    return this.written;
  }

  private write(chunk: Buffer) {
    this.written += chunk.length;
    if (!this.out.write(chunk)) {
      // respect backpressure
      return new Promise<void>((resolve) => this.out.once("drain", resolve));
    }
    return Promise.resolve();
  }

  /** Append one file (STORE). `data` is buffered — keep individual files modest. */
  async addFile(name: string, data: Buffer): Promise<void> {
    if (this.closed) throw new Error("Zip already finalized");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const { time, date } = dosDateTime();
    const offset = this.written;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    await this.write(local);
    await this.write(nameBuf);
    await this.write(data);

    this.entries.push({ name: nameBuf, crc, size: data.length, offset, time, date });
  }

  /** Write central directory + EOCD and end the stream. */
  async finalize(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const cdStart = this.written;
    for (const e of this.entries) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0); // central directory signature
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed
      cd.writeUInt16LE(0x0800, 8); // flags
      cd.writeUInt16LE(0, 10); // method: store
      cd.writeUInt16LE(e.time, 12);
      cd.writeUInt16LE(e.date, 14);
      cd.writeUInt32LE(e.crc, 16);
      cd.writeUInt32LE(e.size, 20);
      cd.writeUInt32LE(e.size, 24);
      cd.writeUInt16LE(e.name.length, 28);
      cd.writeUInt16LE(0, 30); // extra len
      cd.writeUInt16LE(0, 32); // comment len
      cd.writeUInt16LE(0, 34); // disk number
      cd.writeUInt16LE(0, 36); // internal attrs
      cd.writeUInt32LE(0, 38); // external attrs
      cd.writeUInt32LE(e.offset, 42);
      await this.write(cd);
      await this.write(e.name);
    }
    const cdSize = this.written - cdStart;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);

    await this.write(eocd);
    this.out.end();
  }

  /** Abort on error — destroys the stream. */
  destroy(err: Error) {
    this.closed = true;
    this.out.destroy(err);
  }
}
