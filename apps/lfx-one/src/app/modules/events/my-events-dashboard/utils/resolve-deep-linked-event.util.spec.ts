// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MyEvent, MyEventsResponse } from '@lfx-one/shared/interfaces';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { resolveDeepLinkedEvent$ } from './resolve-deep-linked-event.util';

// Regression coverage for PR #2247 review (Copilot): matching must be by id, not by response
// ordering — a regression to `response.data[0]` would pass silently against the e2e mock, which
// only ever returns a single matching row.
describe('resolveDeepLinkedEvent$', () => {
  const buildEvent = (id: string): MyEvent =>
    ({
      id,
      name: `Event ${id}`,
      url: '',
      registrationUrl: null,
      foundation: 'Linux Foundation',
      startDate: '2026-06-30T00:00:00.000Z',
      date: 'Jun 30–Jul 2, 2026',
      location: 'Seattle, WA',
      role: 'Attendee',
      status: 'Registered',
    }) as MyEvent;

  const buildResponse = (data: MyEvent[]): MyEventsResponse => ({ data, total: data.length, pageSize: 10, offset: 0 });

  it('returns the row matching the requested id, even when an earlier row does not match', async () => {
    const target = buildEvent('evt-2');
    const response = buildResponse([buildEvent('evt-1'), target, buildEvent('evt-3')]);

    const result = await firstValueFrom(resolveDeepLinkedEvent$(of(response), 'evt-2', 'visa request'));

    expect(result).toEqual(target);
  });

  it('returns null when no row matches the requested id', async () => {
    const response = buildResponse([buildEvent('evt-1'), buildEvent('evt-3')]);

    const result = await firstValueFrom(resolveDeepLinkedEvent$(of(response), 'evt-2', 'visa request'));

    expect(result).toBeNull();
  });

  it('normalizes a failed fetch into the error sentinel', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await firstValueFrom(
      resolveDeepLinkedEvent$(
        throwError(() => new Error('network error')),
        'evt-2',
        'visa request'
      )
    );

    expect(result).toBe('error');
  });
});
