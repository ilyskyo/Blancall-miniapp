import test from 'node:test';
import assert from 'node:assert/strict';
import { md5Hex, sha256Hex, hash16 } from '../core/utils/digest';

// 期望值由 Python hashlib 生成，用于交叉验证纯 TS 实现
const MD5_VECTORS: Array<[string, string]> = [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['你好，世界。', '86b2826fea7349ce6af96f446d7e2fcf'],
  ['床前明月光，疑是地上霜。', '07aea25b95076a62cf1649704177bac0'],
  ['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
  ['3.14159', 'd69b751558e2033dd8e63fa124676d5a'],
  ['你好😀', '56dcab568c0fc000bdfedeb246359476'],
];

const SHA256_HEAD16_VECTORS: Array<[string, string]> = [
  ['', 'e3b0c44298fc1c14'],
  ['abc', 'ba7816bf8f01cfea'],
  ['你好，世界。', '6ac5565122a5e33a'],
  ['床前明月光，疑是地上霜。', '0c9b923743153534'],
  ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d78094'],
  ['3.14159', 'c0740dd25c9de39b'],
  ['你好😀', '3fe21f1528f50ff7'],
];

test('md5Hex 与 Python hashlib 一致', () => {
  for (const [input, expected] of MD5_VECTORS) {
    assert.equal(md5Hex(input), expected, `md5(${JSON.stringify(input)})`);
  }
});

test('sha256Hex 前 16 字符与 Python hashlib 一致', () => {
  for (const [input, expected] of SHA256_HEAD16_VECTORS) {
    assert.equal(sha256Hex(input).slice(0, 16), expected, `sha256(${JSON.stringify(input)})`);
  }
});

test('hash16 等价于 SHA-256 前 8 字节 hex（句子键 hash16）', () => {
  for (const [input, expected] of SHA256_HEAD16_VECTORS) {
    assert.equal(hash16(input), expected);
  }
  // 句子键: trim 后再哈希（与 Android sentenceKey 一致）
  assert.equal(hash16('  abc  '), hash16('abc'));
});