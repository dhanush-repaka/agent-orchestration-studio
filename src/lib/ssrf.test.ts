import { describe, expect, it } from 'vitest';
import { hostnameAllowedForCredential, isBlockedHostname, timingSafeEqual } from '@/lib/ssrf';

describe('isBlockedHostname', () => {
  it('blocks decimal, hex, link-local, and IPv6-mapped loopback', () => {
    expect(isBlockedHostname('2130706433')).toBe(true);
    expect(isBlockedHostname('0x7f000001')).toBe(true);
    expect(isBlockedHostname('169.254.169.254')).toBe(true);
    expect(isBlockedHostname('fe80::1')).toBe(true);
    expect(isBlockedHostname('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedHostname('n8n.example.com')).toBe(false);
  });
});

describe('hostnameAllowedForCredential', () => {
  it('allows the host and its subdomains only', () => {
    expect(hostnameAllowedForCredential('api.example.com', 'example.com')).toBe(true);
    expect(hostnameAllowedForCredential('example.com', 'example.com')).toBe(true);
    expect(hostnameAllowedForCredential('evil.com', 'example.com')).toBe(false);
  });
});

describe('timingSafeEqual', () => {
  it('compares secrets without a length-short-circuit equality check', () => {
    expect(timingSafeEqual('wh_secret', 'wh_secret')).toBe(true);
    expect(timingSafeEqual('wh_secret', 'wh_otherx')).toBe(false);
    expect(timingSafeEqual('wh_secret', 'short')).toBe(false);
  });
});
