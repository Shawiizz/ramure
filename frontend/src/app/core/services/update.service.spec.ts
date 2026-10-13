import { newer } from './update.service';

describe('a newer version', () => {
  it('is told number by number, not letter by letter', () => {
    expect(newer('v0.10.0', '0.9.3')).toBe(true);
    expect(newer('0.2.0', '0.2.0')).toBe(false);
    expect(newer('v1.0', '1.0.1')).toBe(false);
    expect(newer('2.0.0', '1.99.99')).toBe(true);
  });

  it('comes after its pre-releases', () => {
    expect(newer('1.0.0', '1.0.0-beta.2')).toBe(true);
    expect(newer('1.0.0-beta.2', '1.0.0')).toBe(false);
    expect(newer('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true);
  });
});
