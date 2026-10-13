/** How a file's bytes are read as text, or shown as bytes. */
export type Encoding =
  | 'binary'
  | 'utf-8'
  | 'utf-8-bom'
  | 'utf-16le'
  | 'utf-16be'
  | 'utf-32le'
  | 'utf-32be'
  | 'windows-1252'
  | 'iso-8859-1'
  | 'iso-8859-15'
  | 'windows-1250'
  | 'windows-1251'
  | 'koi8-r'
  | 'shift_jis'
  | 'euc-jp'
  | 'gbk'
  | 'big5'
  | 'euc-kr';

export const ENCODINGS: readonly { id: Encoding; name: string }[] = [
  { id: 'binary', name: 'Binary' },
  { id: 'utf-8', name: 'UTF-8' },
  { id: 'utf-8-bom', name: 'UTF-8 BOM' },
  { id: 'utf-16le', name: 'UTF-16 LE' },
  { id: 'utf-16be', name: 'UTF-16 BE' },
  { id: 'utf-32le', name: 'UTF-32 LE' },
  { id: 'utf-32be', name: 'UTF-32 BE' },
  { id: 'windows-1252', name: 'Windows-1252' },
  { id: 'iso-8859-1', name: 'ISO-8859-1' },
  { id: 'iso-8859-15', name: 'ISO-8859-15' },
  { id: 'windows-1250', name: 'Windows-1250' },
  { id: 'windows-1251', name: 'Windows-1251' },
  { id: 'koi8-r', name: 'KOI8-R' },
  { id: 'shift_jis', name: 'Shift JIS' },
  { id: 'euc-jp', name: 'EUC-JP' },
  { id: 'gbk', name: 'GBK' },
  { id: 'big5', name: 'Big5' },
  { id: 'euc-kr', name: 'EUC-KR' },
];

/** Bytes looked at for a zero byte, the mark of a binary file. */
const SNIFFED = 8000;
/** A hex dump shows this much of a binary file. */
const DUMPED = 1024 * 1024;

/** The encoding a file's bytes most likely have: its byte order mark, else what they hold. */
export function guessEncoding(bytes: Uint8Array): Encoding {
  const starts = (...mark: number[]) => mark.every((b, i) => bytes[i] === b);
  if (starts(0xef, 0xbb, 0xbf)) return 'utf-8-bom';
  if (starts(0xff, 0xfe, 0, 0)) return 'utf-32le';
  if (starts(0, 0, 0xfe, 0xff)) return 'utf-32be';
  if (starts(0xff, 0xfe)) return 'utf-16le';
  if (starts(0xfe, 0xff)) return 'utf-16be';
  if (bytes.subarray(0, SNIFFED).includes(0)) return 'binary';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

/** The bytes as text in `encoding`; as a hex dump for `binary`. */
export function decode(bytes: Uint8Array, encoding: Encoding): string {
  switch (encoding) {
    case 'binary':
      return hexDump(bytes);
    case 'utf-8-bom':
      return new TextDecoder('utf-8').decode(bytes);
    case 'utf-32le':
    case 'utf-32be':
      return utf32(bytes, encoding === 'utf-32le');
    default:
      return new TextDecoder(encoding).decode(bytes);
  }
}

/** UTF-32, which TextDecoder does not read: four bytes a character. */
function utf32(bytes: Uint8Array, littleEndian: boolean): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let text = '';
  for (let i = 0; i + 4 <= bytes.length; i += 4) {
    const point = view.getUint32(i, littleEndian);
    if (i === 0 && point === 0xfeff) continue;
    text += point <= 0x10ffff ? String.fromCodePoint(point) : '�';
  }
  return text;
}

/** Sixteen bytes a line: their offset, their values, and the printable ones as text. */
export function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  const shown = bytes.subarray(0, DUMPED);
  for (let at = 0; at < shown.length; at += 16) {
    const row = shown.subarray(at, at + 16);
    const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const text = [...row].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'));
    lines.push(`${at.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${text.join('')}`);
  }
  if (bytes.length > DUMPED) lines.push('…');
  return lines.join('\n');
}
