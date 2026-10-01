/**
 * 最小 ZIP 读取器（用于 EPUB 解析），仅支持 stored(0) 与 deflate(8)。
 * 不引入第三方解压库。
 */
import * as zlib from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEocd(buf: Buffer): number {
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function readLocalData(buf: Buffer, localOffset: number, compSize: number, method: number): Buffer | null {
  if (localOffset + 30 > buf.length) return null;
  if (buf.readUInt32LE(localOffset) !== LOC_SIG) return null;
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLen + extraLen;
  const end = start + compSize;
  if (end > buf.length) return null;
  const raw = buf.subarray(start, end);
  if (method === 0) return Buffer.from(raw);
  if (method === 8) {
    try {
      return zlib.inflateRawSync(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/** 读取 ZIP 内全部条目（失败返回空数组） */
export function extractZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0) return [];
  const total = buf.readUInt16BE(eocd + 10);
  const cdOffset = buf.readUInt32BE(eocd + 16);
  const entries: ZipEntry[] = [];
  let p = cdOffset;

  for (let i = 0; i < total; i += 1) {
    if (p + 46 > buf.length) break;
    if (buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const data = readLocalData(buf, localOffset, compSize, method);
    if (data) entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}