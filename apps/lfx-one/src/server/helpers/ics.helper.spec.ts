// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: { warning: vi.fn() },
}));
// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest config, and the
// real barrel pulls in Angular-dependent code that fails to JIT-compile outside the browser build.
vi.mock('@lfx-one/shared/utils', () => ({ addMinutesToDate: vi.fn((iso: string) => iso) }));

import { buildVCalendar } from './ics.helper';

describe('buildVCalendar', () => {
  it('omits X-WR-CALNAME when no calname is provided', () => {
    const ics = buildVCalendar(['BEGIN:VEVENT\r\nEND:VEVENT'], '-//LFX//Calendar//EN');

    expect(ics).not.toContain('X-WR-CALNAME');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });

  it('emits an escaped X-WR-CALNAME line right after PRODID/CALSCALE/METHOD when calname is provided', () => {
    const ics = buildVCalendar(['BEGIN:VEVENT\r\nEND:VEVENT'], '-//LFX//Project Calendar//EN', 'CNCF, Inc.');

    const lines = ics.split('\r\n');
    expect(lines).toContain('X-WR-CALNAME:CNCF\\, Inc.');
    // Comes after the fixed header block and before the events.
    expect(lines.indexOf('X-WR-CALNAME:CNCF\\, Inc.')).toBeGreaterThan(lines.indexOf('METHOD:PUBLISH'));
    expect(lines.indexOf('X-WR-CALNAME:CNCF\\, Inc.')).toBeLessThan(lines.indexOf('BEGIN:VEVENT'));
  });

  it('folds a long calendar name per RFC 5545 line-length limits', () => {
    const longName = 'A'.repeat(100);
    const ics = buildVCalendar([], '-//LFX//Calendar//EN', longName);

    const rawLines = ics.split('\r\n');
    const calnameStart = rawLines.findIndex((line) => line.startsWith('X-WR-CALNAME:'));
    expect(calnameStart).toBeGreaterThanOrEqual(0);
    // Folded continuation lines are prefixed with a single space.
    expect(rawLines[calnameStart + 1].startsWith(' ')).toBe(true);
  });
});
