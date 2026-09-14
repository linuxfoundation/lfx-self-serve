// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCertificateFileName, isBackfillEventSource } from './event.utils';

describe('isBackfillEventSource', () => {
  it('matches the canonical value', () => {
    expect(isBackfillEventSource('backfill')).toBe(true);
  });

  it.each([['Backfill'], ['BACKFILL'], ['BackFill']])('is case-insensitive for %s', (source) => {
    expect(isBackfillEventSource(source)).toBe(true);
  });

  it.each([[' backfill'], ['backfill '], ['  Backfill  '], ['\tbackfill\n'], ['\r\nbackfill\t ']])('strips the SQL-aligned whitespace set in %j', (source) => {
    expect(isBackfillEventSource(source)).toBe(true);
  });

  // Deliberate parity boundary: String.prototype.trim() strips these, but Snowflake's
  // TRIM(EVENT_SOURCE, ' \t\n\r') cannot, and Snowflake has no ECMAScript-whitespace equivalent.
  // Both sides must agree, so this side is narrowed to match — such a value reads as non-backfill
  // in JS and SQL alike, and the row falls back to the stored IS_PAST_EVENT.
  it.each([['\u000Bbackfill'], ['\u000Cbackfill'], ['\u00A0backfill'], ['\uFEFFbackfill'], ['\u2028backfill'], ['\u3000backfill'], ['backfill\u00A0']])(
    'rejects %j — whitespace that trim() strips but Snowflake TRIM cannot',
    (source) => {
      expect(isBackfillEventSource(source)).toBe(false);
      // Guards the premise above: plain trim() would have matched, which is the divergence avoided.
      expect(source.trim().toLowerCase()).toBe('backfill');
    }
  );

  it.each([['cvent'], ['bevy'], ['platform'], ['backfilled'], ['back fill'], ['']])('rejects %j', (source) => {
    expect(isBackfillEventSource(source)).toBe(false);
  });

  it.each([[null], [undefined]])('rejects %p without throwing', (source) => {
    expect(isBackfillEventSource(source)).toBe(false);
  });
});

describe('buildCertificateFileName', () => {
  // Pinned to UTC so a 'Z'-anchored input's local-calendar-date rendering (matching
  // CertificateService's PDF body date) is deterministic regardless of the machine's TZ.
  afterEach(() => vi.unstubAllEnvs());

  it('slugifies the event name and appends the start date', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(buildCertificateFileName('KubeCon + CloudNativeCon NA 2025', '2025-11-10T00:00:00.000Z', 'evt-1')).toBe(
      'certificate-of-attendance-kubecon-cloudnativecon-na-2025-2025-11-10.pdf'
    );
  });

  it('handles a Snowflake-formatted timestamp (space-separated, no offset), parsed in local time', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(buildCertificateFileName('Open Source Summit', '2025-11-10 08:00:00', 'evt-2')).toBe('certificate-of-attendance-open-source-summit-2025-11-10.pdf');
  });

  it('handles a Date instance', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(buildCertificateFileName('Open Source Summit', new Date('2025-11-10T00:00:00.000Z'), 'evt-3')).toBe(
      'certificate-of-attendance-open-source-summit-2025-11-10.pdf'
    );
  });

  it('drops punctuation from the event name into hyphens rather than mangling the slug', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(buildCertificateFileName("O'Reilly's Conf: AI & ML!", '2025-06-01T00:00:00.000Z', 'evt-4')).toBe(
      'certificate-of-attendance-o-reilly-s-conf-ai-ml-2025-06-01.pdf'
    );
  });

  it('slugifies a non-ASCII event name into a safe, readable name rather than rejecting it', () => {
    vi.stubEnv('TZ', 'UTC');
    const name = buildCertificateFileName('Kubernetes 会議 2025', '2025-06-01T00:00:00.000Z', 'evt-5');
    expect(name).toBe('certificate-of-attendance-kubernetes-会議-2025-2025-06-01.pdf');
  });

  it('keeps an all-non-ASCII event name as its own segment rather than collapsing to an empty slug', () => {
    vi.stubEnv('TZ', 'UTC');
    // A purely non-Latin name has nothing an ASCII-only slugger would keep; two such events on
    // the same date must not collide on the same filename.
    const name = buildCertificateFileName('会議', '2025-06-01T00:00:00.000Z', 'evt-13');
    expect(name).toBe('certificate-of-attendance-会議-2025-06-01.pdf');
  });

  it('omits the date segment when the start date is missing', () => {
    expect(buildCertificateFileName('Open Source Summit', null, 'evt-6')).toBe('certificate-of-attendance-open-source-summit.pdf');
  });

  it('omits the date segment when the start date is unparseable', () => {
    expect(buildCertificateFileName('Open Source Summit', 'not-a-date', 'evt-7')).toBe('certificate-of-attendance-open-source-summit.pdf');
  });

  it('omits the name segment when the event name is missing', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(buildCertificateFileName(null, '2025-11-10T00:00:00.000Z', 'evt-8')).toBe('certificate-of-attendance-2025-11-10.pdf');
  });

  it('falls back to the sanitized event id when both name and date are unavailable', () => {
    expect(buildCertificateFileName(null, null, 'evt-9')).toBe('certificate-of-attendance-evt-9.pdf');
  });

  it('falls back to the event id when the name slugifies to nothing (e.g. punctuation-only)', () => {
    expect(buildCertificateFileName('!!!', null, 'evt-10')).toBe('certificate-of-attendance-evt-10.pdf');
  });

  it('renders the date in local time, matching the PDF body rather than the UTC date', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    // Still Nov 9 in America/Los_Angeles (UTC-8 in November) — the local calendar date, not the UTC one.
    expect(buildCertificateFileName('Open Source Summit', '2025-11-10T05:00:00.000Z', 'evt-11')).toBe(
      'certificate-of-attendance-open-source-summit-2025-11-09.pdf'
    );
  });

  it('truncates a very long event name so the date discriminator is never dropped by the overall filename cap', () => {
    vi.stubEnv('TZ', 'UTC');
    const longName = 'A'.repeat(200);
    const name = buildCertificateFileName(longName, '2025-11-10T00:00:00.000Z', 'evt-12');
    expect(name.endsWith('-2025-11-10.pdf')).toBe(true);
  });

  it('preserves combining marks in scripts that require them (e.g. Devanagari) instead of dropping them', () => {
    // हिन्दी is base consonants + combining vowel signs/virama — a \p{L}-only filter reduces it
    // to the unreadable "ह-न-द" and can collide distinct names on the same date.
    expect(buildCertificateFileName('हिन्दी', null, 'evt-16')).toBe('certificate-of-attendance-हिन्दी.pdf');
  });

  it('never leaves an unpaired surrogate after truncating an astral-character event name', () => {
    vi.stubEnv('TZ', 'UTC');
    // U+10400 is an astral letter, i.e. a surrogate pair — a naive UTF-16 code-unit slice can
    // split the pair and leave a lone high surrogate, which makes encodeURIComponent() throw
    // downstream in contentDispositionAttachment().
    const astralName = '𐐀'.repeat(200);
    const name = buildCertificateFileName(astralName, '2025-06-01T00:00:00.000Z', 'evt-15');
    expect(() => encodeURIComponent(name)).not.toThrow();
  });

  it('keeps the date suffix intact for a long name whose diacritics expand under NFD normalization', () => {
    vi.stubEnv('TZ', 'UTC');
    // sanitizeFilename() NFD-normalizes the whole string, which expands each precomposed 'é'
    // into 'e' + a combining acute — budgeting the name against the pre-expansion length let a
    // long accented name grow past the overall cap and crowd the date out of the final trim.
    const accentedName = 'é'.repeat(100);
    const name = buildCertificateFileName(accentedName, '2025-06-01T00:00:00.000Z', 'evt-14');
    expect(name.endsWith('-2025-06-01.pdf')).toBe(true);
  });
});
