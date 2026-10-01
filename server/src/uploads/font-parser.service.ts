import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';

export interface FontInfo {
  family: string;
  format: 'truetype' | 'cff';
}

/**
 * 最小 sfnt（TTF/OTF）解析器：校验魔数并读取 name 表家族名。
 * 不引入字体库；仅支持单字体文件（不支持 TTC 字体集合）。
 */
@Injectable()
export class FontParserService {
  /** 校验是否为受支持的 sfnt 字体 */
  validate(buffer: Buffer): FontInfo {
    if (buffer.length < 12) throw AppError.invalidArgument('字体文件过小，不是合法的 TTF/OTF');
    const magic = buffer.readUInt32BE(0);
    let format: FontInfo['format'];
    if (magic === 0x00010000) {
      format = 'truetype';
    } else if (magic === 0x4f54544f) {
      // 'OTTO'
      format = 'cff';
    } else if (magic === 0x74746366) {
      // 'ttcf' —— 字体集合，规范明确不支持
      throw AppError.invalidArgument('不支持 .ttc 字体集合，请上传单个 TTF 或 OTF');
    } else {
      throw AppError.invalidArgument('字体魔数校验失败：仅支持 TTF(0x00010000) 或 OTF(OTTO)');
    }

    const family = this.readFamilyName(buffer);
    if (!family) throw AppError.invalidArgument('字体 name 表解析失败，无法获取家族名');
    return { family, format };
  }

  /** 读取 name 表家族名（优先 Windows en-US 的印刷家族名） */
  private readFamilyName(buffer: Buffer): string | null {
    const numTables = buffer.readUInt16BE(4);
    let nameOffset = -1;

    for (let i = 0; i < numTables; i += 1) {
      const rec = 12 + i * 16;
      if (rec + 16 > buffer.length) break;
      const tag = buffer.toString('ascii', rec, rec + 4);
      if (tag === 'name') {
        nameOffset = buffer.readUInt32BE(rec + 8);
        break;
      }
    }
    if (nameOffset < 0 || nameOffset + 6 > buffer.length) return null;

    // name 表：format(2) count(2) stringOffset(2) nameRecord[count](12 bytes each)
    const count = buffer.readUInt16BE(nameOffset + 2);
    const storageBase = nameOffset + buffer.readUInt16BE(nameOffset + 4);

    interface Candidate {
      score: number;
      value: string;
    }
    const candidates: Candidate[] = [];

    for (let i = 0; i < count; i += 1) {
      const rec = nameOffset + 6 + i * 12;
      if (rec + 12 > buffer.length) break;
      const platformID = buffer.readUInt16BE(rec);
      const encodingID = buffer.readUInt16BE(rec + 2);
      const languageID = buffer.readUInt16BE(rec + 4);
      const nameID = buffer.readUInt16BE(rec + 6);
      const length = buffer.readUInt16BE(rec + 8);
      const offset = buffer.readUInt16BE(rec + 10);

      // 只关心家族名（1）与印刷家族名（16）
      if (nameID !== 1 && nameID !== 16) continue;

      const start = storageBase + offset;
      const end = start + length;
      if (start < 0 || end > buffer.length) continue;
      const slice = buffer.subarray(start, end);

      let value: string;
      if (platformID === 3) {
        value = this.decodeUtf16Be(slice);
      } else if (platformID === 1) {
        value = slice.toString('latin1');
      } else if (platformID === 0) {
        value = this.decodeUtf16Be(slice);
      } else {
        continue;
      }
      value = value.replace(/\u0000/g, '').trim();
      if (value === '') continue;

      // 打分：nameID 16 优于 1；Windows(3) 优于 Mac(1)；en-US(0x409) 优于其他
      let score = 0;
      if (nameID === 16) score += 100;
      if (platformID === 3) score += 50;
      if (platformID === 3 && encodingID === 1) score += 10;
      if (languageID === 0x409) score += 20;
      else if (platformID === 3 && (languageID === 0x804 || languageID === 0x404)) score += 15;

      candidates.push({ score, value });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].value;
  }

  /** UTF-16BE → JS 字符串 */
  private decodeUtf16Be(buf: Buffer): string {
    const copy = Buffer.from(buf);
    copy.swap16();
    return copy.toString('utf16le');
  }
}