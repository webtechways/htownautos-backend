import { isPrivateOrReservedIp } from './ssrf-guard';

describe('isPrivateOrReservedIp', () => {
  it.each([
    ['10.0.0.5', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.1.1', true],
    ['127.0.0.1', true],
    ['169.254.1.1', true],
    ['0.0.0.0', true],
    ['100.64.0.1', true], // CGNAT
    ['224.0.0.1', true], // multicast
    ['255.255.255.255', true],
  ])('flags IPv4 %s as private/reserved', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });

  it.each([
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['172.15.255.255', false], // just outside 172.16.0.0/12
    ['172.32.0.0', false], // just outside 172.16.0.0/12
    ['93.184.216.34', false],
  ])('lets public IPv4 %s through', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });

  it.each([
    ['::1', true],
    ['fe80::1', true],
    ['fc00::1', true],
    ['fd00::1', true],
    ['ff02::1', true],
    ['::ffff:127.0.0.1', true], // IPv4-mapped loopback
    ['::ffff:10.0.0.1', true], // IPv4-mapped private
  ])('flags IPv6 %s as private/reserved', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });

  it.each([
    ['2001:4860:4860::8888', false], // Google public DNS
    ['::ffff:8.8.8.8', false], // IPv4-mapped public
  ])('lets public IPv6 %s through', (ip, expected) => {
    expect(isPrivateOrReservedIp(ip)).toBe(expected);
  });

  it('fails closed on an unparseable address', () => {
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
  });
});
