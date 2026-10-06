// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MENTEE_NOTE_MAX } from '@lfx-one/shared/constants';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

const { ServiceValidationError } = await import('../errors');
const { parseMentorshipApplicationNote, saveMentorshipApplicationNote } = await import('./mentorship-application-note.helper');

type Proxy = Parameters<typeof saveMentorshipApplicationNote>[0];

const OPERATION = 'update_mentorship_application_note';
const APPLICATION_ID = '5d1c8e2f-3a4b-4c6d-8e9f-0a1b2c3d4e5f';

describe('parseMentorshipApplicationNote', () => {
  it('returns the note trimmed', () => {
    expect(parseMentorshipApplicationNote({ note: '  Strong screening call.  ' }, OPERATION)).toBe('Strong screening call.');
  });

  it('reads a note blank once trimmed as a clear', () => {
    expect(parseMentorshipApplicationNote({ note: '   ' }, OPERATION)).toBe('');
  });

  it('accepts a note of exactly the maximum once trimmed', () => {
    expect(parseMentorshipApplicationNote({ note: ` ${'a'.repeat(MENTORSHIP_MENTEE_NOTE_MAX)} ` }, OPERATION)).toHaveLength(MENTORSHIP_MENTEE_NOTE_MAX);
  });

  it.each([[{}], [{ note: 42 }], [{ note: null }], [null], [undefined]])('refuses a body without a string note: %j', (body) => {
    expect(fieldErrorOf(() => parseMentorshipApplicationNote(body, OPERATION))).toEqual({ field: 'note', message: 'note must be a string' });
  });

  it('refuses a note over the maximum', () => {
    expect(fieldErrorOf(() => parseMentorshipApplicationNote({ note: 'a'.repeat(MENTORSHIP_MENTEE_NOTE_MAX + 1) }, OPERATION))).toEqual({
      field: 'note',
      message: `note must be at most ${MENTORSHIP_MENTEE_NOTE_MAX} characters`,
    });
  });
});

/** Runs `parse`, expects it to throw a ServiceValidationError, and returns its one field error. */
function fieldErrorOf(parse: () => unknown): { field: string; message: string } {
  try {
    parse();
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceValidationError);
    const [{ field, message }] = (error as InstanceType<typeof ServiceValidationError>).validationErrors;
    return { field, message };
  }
  throw new Error('expected parse to throw');
}

describe('saveMentorshipApplicationNote', () => {
  const req = { path: `/api/mentorship/admin/applications/${APPLICATION_ID}/note` } as Request;

  it('puts the note upstream as reviewer_note', async () => {
    const proxyRequest = vi.fn().mockResolvedValue(undefined);

    await saveMentorshipApplicationNote({ proxyRequest } as unknown as Proxy, req, APPLICATION_ID, 'Strong screening call.');

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `/mentorship/v1/applications/${APPLICATION_ID}/note`, 'PUT', undefined, {
      reviewer_note: 'Strong screening call.',
    });
  });

  it('lets an upstream failure through', async () => {
    const failure = new Error('upstream 404');
    const proxyRequest = vi.fn().mockRejectedValue(failure);

    await expect(saveMentorshipApplicationNote({ proxyRequest } as unknown as Proxy, req, APPLICATION_ID, '')).rejects.toBe(failure);
  });
});
