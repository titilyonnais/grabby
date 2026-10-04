import { describe, expect, it } from 'vitest';
import { isPrivateHost, reachableFrom } from '../../src/parsers/url';

describe('isPrivateHost', () => {
  it.each([
    'http://localhost:8080/a.m3u8',
    'http://127.0.0.1/x',
    'http://10.1.2.3/x',
    'http://172.20.0.1/x',
    'http://192.168.1.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/x',
    'http://[fd12:3456::1]/x',
    'http://printer.local/x',
  ])('flags %s', (u) => expect(isPrivateHost(u)).toBe(true));

  it.each(['https://cdn.example.com/x', 'http://8.8.8.8/x', 'http://172.32.0.1/x', 'https://[2606:4700::1111]/x', 'nope'])(
    'allows %s',
    (u) => expect(isPrivateHost(u)).toBe(false),
  );
});

describe('reachableFrom', () => {
  it('blocks public sources pointing into the local network, not local ones', () => {
    expect(reachableFrom('https://site.com/master.m3u8', 'http://192.168.1.1/v.m3u8')).toBe(false);
    expect(reachableFrom('http://127.0.0.1:4000/master.m3u8', 'http://127.0.0.1:4000/v.m3u8')).toBe(true);
    expect(reachableFrom('https://site.com/master.m3u8', 'https://cdn.com/v.m3u8')).toBe(true);
  });
});
