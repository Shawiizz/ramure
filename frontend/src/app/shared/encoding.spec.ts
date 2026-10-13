import { decode, guessEncoding, hexDump } from './encoding';

const bytes = (...values: number[]) => new Uint8Array(values);
const utf8 = (text: string) => new TextEncoder().encode(text);

describe('encodings', () => {
  it('are guessed from a byte order mark, a zero byte, or what UTF-8 can read', () => {
    expect(guessEncoding(bytes(0xef, 0xbb, 0xbf, 0x61))).toBe('utf-8-bom');
    expect(guessEncoding(bytes(0xff, 0xfe, 0x61, 0))).toBe('utf-16le');
    expect(guessEncoding(bytes(0xff, 0xfe, 0, 0, 0x61, 0, 0, 0))).toBe('utf-32le');
    expect(guessEncoding(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0))).toBe('binary');
    expect(guessEncoding(utf8('déjà vu'))).toBe('utf-8');
    expect(guessEncoding(bytes(0x64, 0xe9, 0x6a, 0xe0))).toBe('windows-1252');
  });

  it('read the same text from each encoding', () => {
    expect(decode(bytes(0x64, 0xe9, 0x6a, 0xe0), 'windows-1252')).toBe('déjà');
    expect(decode(bytes(0xef, 0xbb, 0xbf, 0x61), 'utf-8-bom')).toBe('a');
    expect(decode(bytes(0, 0x61, 0, 0xe9), 'utf-16be')).toBe('aé');
    expect(decode(bytes(0xff, 0xfe, 0, 0, 0x61, 0, 0, 0, 0x00, 0xf6, 0x01, 0), 'utf-32le')).toBe(
      'a😀',
    );
  });

  it('show bytes as a hex dump, sixteen a line', () => {
    const dump = hexDump(utf8('Hello, binary world!'));
    expect(dump.split('\n')).toEqual([
      '00000000  48 65 6c 6c 6f 2c 20 62 69 6e 61 72 79 20 77 6f  Hello, binary wo',
      '00000010  72 6c 64 21                                      rld!',
    ]);
  });
});
