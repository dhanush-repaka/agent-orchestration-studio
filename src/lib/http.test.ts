import { describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, isHttpNodeType } from '@/lib/http';
import { cronMatches, isScheduleDue, scheduleIntervalMs } from '@/lib/cron';

describe('assertPublicHttpUrl', () => {
  it('allows public https URLs', () => {
    expect(assertPublicHttpUrl('https://n8n.example.com/webhook/abc').hostname).toBe('n8n.example.com');
  });

  it('rejects localhost and private hosts', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1/secret')).toThrow(/not allowed/);
    expect(() => assertPublicHttpUrl('http://10.0.0.4/x')).toThrow(/Private/);
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(/http/);
  });
});

describe('isHttpNodeType', () => {
  it('treats API Request and REST API palette nodes as HTTP', () => {
    expect(isHttpNodeType('api-request')).toBe(true);
    expect(isHttpNodeType('rest-api')).toBe(true);
    expect(isHttpNodeType('http-request')).toBe(true);
    expect(isHttpNodeType('condition')).toBe(false);
  });
});

describe('schedule', () => {
  it('parses every-N interval expressions', () => {
    expect(scheduleIntervalMs('every 15m')).toBe(15 * 60 * 1000);
    expect(scheduleIntervalMs('every 2 hours')).toBe(2 * 60 * 60 * 1000);
  });

  it('matches a simple UTC cron field set', () => {
    const at = new Date(Date.UTC(2026, 7, 17, 6, 0, 0));
    expect(cronMatches('0 6 * * *', at)).toBe(true);
    expect(cronMatches('30 6 * * *', at)).toBe(false);
  });

  it('is due when the interval has elapsed and not before', () => {
    const now = new Date('2026-08-17T12:00:00Z');
    expect(isScheduleDue('every 15m', '2026-08-17T11:40:00Z', now)).toBe(true);
    expect(isScheduleDue('every 15m', '2026-08-17T11:50:00Z', now)).toBe(false);
  });
});
