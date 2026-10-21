// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { SegmentEvent } from '../interfaces/segment.interface';
import { buildSegmentPageEvent, sanitizeAnalyticsPath, sanitizeAnalyticsSearch, sanitizeAnalyticsUrl, sanitizeSegmentEvent } from './analytics-url.utils';

/**
 * Guards linuxfoundation/lfx-self-serve-ops#49: meeting passcodes and other URL-borne secrets must
 * never reach Segment. The policy is an allowlist — only `utm_*` query params survive — so these
 * specs also pin that unknown params are dropped, not just the known secret keys.
 */
const ORIGIN = 'https://app.lfx.example';
const SECRET = 'SYNTHETIC_SECRET';

describe('sanitizeAnalyticsSearch', () => {
  it('drops password and token params', () => {
    expect(sanitizeAnalyticsSearch(`?password=${SECRET}&token=${SECRET}`)).toBe('');
  });

  it('keeps utm params mixed with secrets, in order', () => {
    expect(sanitizeAnalyticsSearch(`?utm_source=news&password=${SECRET}&utm_medium=email`)).toBe('?utm_source=news&utm_medium=email');
  });

  it('keeps duplicate utm params', () => {
    expect(sanitizeAnalyticsSearch('?utm_tag=a&utm_tag=b')).toBe('?utm_tag=a&utm_tag=b');
  });

  it('matches the utm_ prefix case-sensitively', () => {
    expect(sanitizeAnalyticsSearch(`?UTM_SOURCE=${SECRET}&Utm_medium=${SECRET}`)).toBe('');
  });

  it('accepts a search string without a leading ?', () => {
    expect(sanitizeAnalyticsSearch('utm_source=x')).toBe('?utm_source=x');
  });

  it('ignores a trailing hash', () => {
    expect(sanitizeAnalyticsSearch(`?utm_source=x#access_token=${SECRET}`)).toBe('?utm_source=x');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeAnalyticsSearch('')).toBe('');
  });
});

describe('sanitizeAnalyticsUrl', () => {
  it('removes secret query params and the hash from an absolute URL', () => {
    const result = sanitizeAnalyticsUrl(`${ORIGIN}/meetings/abc?password=${SECRET}#access_token=${SECRET}`);

    expect(result).toBe(`${ORIGIN}/meetings/abc`);
    expect(result).not.toContain(SECRET);
  });

  it('keeps utm params on an absolute URL', () => {
    expect(sanitizeAnalyticsUrl(`${ORIGIN}/meetings/abc?password=${SECRET}&utm_source=x`)).toBe(`${ORIGIN}/meetings/abc?utm_source=x`);
  });

  it('removes userinfo from an absolute URL', () => {
    expect(sanitizeAnalyticsUrl(`https://user:${SECRET}@app.lfx.example/x`)).toBe(`${ORIGIN}/x`);
  });

  it('keeps a relative URL relative', () => {
    expect(sanitizeAnalyticsUrl(`/meetings/abc?password=${SECRET}&utm_campaign=y#frag`)).toBe('/meetings/abc?utm_campaign=y');
  });

  it('resolves a relative URL against an explicit base without emitting the base', () => {
    expect(sanitizeAnalyticsUrl(`../b?password=${SECRET}`, `${ORIGIN}/a/c`)).toBe('/b');
  });

  it('cuts an unparseable URL at the first ? or #', () => {
    expect(sanitizeAnalyticsUrl(`http://[bad/meetings?password=${SECRET}`)).toBe('http://[bad/meetings');
    expect(sanitizeAnalyticsUrl(`http://[bad/meetings#${SECRET}?x`)).toBe('http://[bad/meetings');
  });

  it('returns an empty string for an empty referrer', () => {
    expect(sanitizeAnalyticsUrl('')).toBe('');
  });
});

describe('sanitizeAnalyticsPath', () => {
  it('reduces a router URL to its pathname', () => {
    expect(sanitizeAnalyticsPath(`/meetings/abc?password=${SECRET}#frag`)).toBe('/meetings/abc');
  });

  it('reduces an absolute URL to its pathname', () => {
    expect(sanitizeAnalyticsPath(`${ORIGIN}/meetings/abc?password=${SECRET}`)).toBe('/meetings/abc');
  });

  it('cuts an unparseable URL at the first ? or #', () => {
    expect(sanitizeAnalyticsPath(`http://[bad/meetings?password=${SECRET}`)).toBe('http://[bad/meetings');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeAnalyticsPath('')).toBe('');
  });
});

describe('buildSegmentPageEvent', () => {
  it('builds a meeting page event with no passcode in any field', () => {
    const event = buildSegmentPageEvent(
      `/meetings/abc?password=${SECRET}`,
      `${ORIGIN}/meetings/abc?password=${SECRET}#frag`,
      'Meeting | LFX',
      `${ORIGIN}/dashboard?token=${SECRET}#h`
    );

    expect(event).toEqual({
      name: 'abc',
      path: '/meetings/abc',
      url: `${ORIGIN}/meetings/abc`,
      search: '',
      title: 'Meeting | LFX',
      referrer: `${ORIGIN}/dashboard`,
    });
    expect(JSON.stringify(event)).not.toContain(SECRET);
  });

  it('retains utm params in url and search', () => {
    const event = buildSegmentPageEvent(`/meetings/abc?password=${SECRET}&utm_source=x`, `${ORIGIN}/meetings/abc?password=${SECRET}&utm_source=x`, 't', '');

    expect(event.url).toBe(`${ORIGIN}/meetings/abc?utm_source=x`);
    expect(event.search).toBe('?utm_source=x');
    expect(event.path).toBe('/meetings/abc');
  });

  it('names the root page Home and keeps an empty referrer explicit', () => {
    const event = buildSegmentPageEvent(`/?password=${SECRET}`, `${ORIGIN}/`, 'Home | LFX', '');

    expect(event.name).toBe('Home');
    expect(event).toHaveProperty('referrer', '');
    expect(event).toHaveProperty('search', '');
  });

  it('uses an empty search when the href cannot be parsed', () => {
    expect(buildSegmentPageEvent('/x', `http://[bad/x?utm_source=y&password=${SECRET}`, 't', '').search).toBe('');
  });
});

describe('sanitizeSegmentEvent', () => {
  const rawPage = (): Record<string, unknown> => ({
    url: `${ORIGIN}/meetings/abc?password=${SECRET}&utm_source=x#frag`,
    search: `?password=${SECRET}&utm_source=x`,
    path: '/meetings/abc',
    referrer: `${ORIGIN}/invite?token=${SECRET}`,
    title: 'Meeting | LFX',
  });

  const sanitizedPage = {
    url: `${ORIGIN}/meetings/abc?utm_source=x`,
    search: '?utm_source=x',
    path: '/meetings/abc',
    referrer: `${ORIGIN}/invite`,
    title: 'Meeting | LFX',
  };

  it.each(['page', 'track', 'identify'])('sanitizes context.page on a %s event', (type) => {
    const event: SegmentEvent = { type, messageId: 'msg-1', context: { page: rawPage() } };

    sanitizeSegmentEvent(event);

    expect(event.context?.page).toEqual(sanitizedPage);
    expect(JSON.stringify(event)).not.toContain(SECRET);
  });

  it('sanitizes page properties', () => {
    const event: SegmentEvent = { type: 'page', messageId: 'msg-1', properties: rawPage(), context: { page: rawPage() } };

    sanitizeSegmentEvent(event);

    expect(event.properties).toEqual(sanitizedPage);
    expect(JSON.stringify(event)).not.toContain(SECRET);
  });

  it('returns the same object with type and messageId preserved', () => {
    const event: SegmentEvent = { type: 'track', messageId: 'msg-42', event: 'Clicked', context: { page: rawPage() } };

    const result = sanitizeSegmentEvent(event);

    expect(result).toBe(event);
    expect(result.type).toBe('track');
    expect(result.messageId).toBe('msg-42');
    expect(result['event']).toBe('Clicked');
  });

  it('leaves events without context or properties alone', () => {
    const event: SegmentEvent = { type: 'identify', messageId: 'msg-1' };

    expect(sanitizeSegmentEvent(event)).toEqual({ type: 'identify', messageId: 'msg-1' });
  });

  it('leaves a context without page alone', () => {
    const event: SegmentEvent = { type: 'track', messageId: 'msg-1', context: { locale: 'en' } };

    sanitizeSegmentEvent(event);

    expect(event.context).toEqual({ locale: 'en' });
  });

  it('does not add missing URL fields', () => {
    const event: SegmentEvent = { type: 'track', messageId: 'msg-1', properties: { label: 'x' } };

    sanitizeSegmentEvent(event);

    expect(event.properties).toEqual({ label: 'x' });
  });

  it('removes present non-string URL fields', () => {
    const event: SegmentEvent = {
      type: 'page',
      messageId: 'msg-1',
      context: { page: { url: { href: `${ORIGIN}/?password=${SECRET}` }, search: 42, path: null, referrer: undefined, title: 't' } },
    };

    sanitizeSegmentEvent(event);

    expect(event.context?.page).toEqual({ title: 't' });
  });

  it('throws on a non-object container so the wrapper cancels the event', () => {
    const event = { type: 'page', messageId: 'msg-1', properties: `?password=${SECRET}` } as unknown as SegmentEvent;

    expect(() => sanitizeSegmentEvent(event)).toThrow(TypeError);
  });
});
