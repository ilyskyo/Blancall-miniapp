/**
 * 文本解析工具：编码探测、HTML/RTF 清洗、DOC 尽力抽取、分段
 */

const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  mdash: '—',
  ndash: '–',
};

export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function countReplacement(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) === 0xfffd) n += 1;
  return n;
}

/** 解码文本：优先 UTF-8，疑似乱码时尝试 GB18030 / Big5 */
export function decodeText(buf: Buffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const bad = countReplacement(utf8);
  if (bad === 0) return stripBom(utf8);

  for (const enc of ['gb18030', 'big5']) {
    try {
      const alt = new TextDecoder(enc, { fatal: false }).decode(buf);
      if (countReplacement(alt) < bad) return stripBom(alt);
    } catch {
      // 运行时未内置该编码，忽略
    }
  }
  return stripBom(utf8);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number.parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? m);
}

/** HTML → 纯文本 */
export function stripHtml(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s);
}

/** RTF → 纯文本（尽力解析） */
export function stripRtf(rtf: string): string {
  let s = rtf;
  // \uN? 单字符
  s = s.replace(/\\u(-?\d+)\??/g, (_m, d: string) => {
    let n = Number.parseInt(d, 10);
    if (n < 0) n += 65536;
    return String.fromCharCode(n);
  });
  // \'hh 十六进制字节（按 latin1 处理，ASCII 场景可直接还原）
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16)));
  s = s.replace(/\\par[d]?\b/g, '\n');
  s = s.replace(/\\tab\b/g, '\t');
  s = s.replace(/\\[a-zA-Z]+-?\d*\s?/g, ' ');
  s = s.replace(/[{}]/g, '');
  return s;
}

function isPrintable(cp: number): boolean {
  if (cp === 9 || cp === 10 || cp === 13) return true;
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp >= 0x4e00 && cp <= 0x9fff) return true; // CJK 统一表意文字
  if (cp >= 0x3000 && cp <= 0x303f) return true; // CJK 标点
  if (cp >= 0xff00 && cp <= 0xffef) return true; // 全角字符
  return false;
}

function filterPrintable(s: string): string {
  const out: string[] = [];
  let run = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isPrintable(cp)) {
      out.push(ch);
      run += 1;
    } else if (run > 0) {
      out.push('\n');
      run = 0;
    }
  }
  return out.join('');
}

/**
 * DOC(OLE2) 尽力抽取：Word 97 正文多为 UTF-16LE，也常见 GB18030。
 * 分别解码后取「可打印字符更多」的结果。
 */
export function extractDocText(buf: Buffer): string {
  const asUtf16 = filterPrintable(buf.toString('utf16le'));
  let asGb = '';
  try {
    asGb = filterPrintable(new TextDecoder('gb18030', { fatal: false }).decode(buf));
  } catch {
    asGb = filterPrintable(buf.toString('latin1'));
  }
  const better = asUtf16.length >= asGb.length ? asUtf16 : asGb;
  // 去掉超短碎片行（二进制噪声）
  return better
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 2)
    .join('\n');
}

/** 文本 → 段落数组（按空行/换行切分，去除空段） */
export function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((p) => p.replace(/\u00a0/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** 从正文首行猜标题（无显式标题时使用） */
export function guessTitle(text: string, fallback: string): string {
  const firstLine = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return fallback;
  return firstLine.slice(0, 80);
}