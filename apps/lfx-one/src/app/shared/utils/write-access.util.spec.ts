// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { meetingWriteAccessState, probeCommitteeWriters, resolveSurveyCommitteeCandidates, resolveVoteCanManage } from './write-access.util';

describe('meetingWriteAccessState', () => {
  it('grants access for a project writer or meeting coordinator', () => {
    expect(meetingWriteAccessState({ writer: true } as never)).toBe(true);
    expect(meetingWriteAccessState({ meetingCoordinator: true } as never)).toBe(true);
  });

  it('denies access when both checks come back a confirmed false', () => {
    expect(meetingWriteAccessState({ writer: false, meetingCoordinator: false } as never)).toBe(false);
  });

  it('reports unknown (not denied) when the lookup itself failed', () => {
    expect(meetingWriteAccessState(null)).toBeUndefined();
  });

  it('reports unknown (not denied) when meetingCoordinator is omitted — the BFF FGA-check-failed shape (linuxfoundation/lfx-self-serve-ops#500)', () => {
    expect(meetingWriteAccessState({ writer: false, meetingCoordinator: undefined } as never)).toBeUndefined();
  });
});

describe('resolveSurveyCommitteeCandidates', () => {
  const committees = [{ committee_uid: 'primary' }, { committee_uid: 'secondary' }, { committee_uid: 'third' }];

  it('prioritizes a matching URL committee and preserves the remaining order', () => {
    expect(resolveSurveyCommitteeCandidates(committees, 'secondary')).toEqual(['secondary', 'primary', 'third']);
  });

  it('keeps the primary committee first without a URL hint', () => {
    expect(resolveSurveyCommitteeCandidates(committees, null)).toEqual(['primary', 'secondary', 'third']);
  });

  it('never adds an unrelated URL committee', () => {
    expect(resolveSurveyCommitteeCandidates(committees, 'attacker')).toEqual(['primary', 'secondary', 'third']);
  });

  it.each([[], null, undefined])('preserves the URL fallback for committee-less surveys (%s)', (value) => {
    expect(resolveSurveyCommitteeCandidates(value, 'fallback')).toEqual(['fallback']);
    expect(resolveSurveyCommitteeCandidates(value, null)).toEqual([]);
  });

  it('drops duplicate and empty uids without changing candidate order', () => {
    expect(
      resolveSurveyCommitteeCandidates(
        [{ committee_uid: '' }, { committee_uid: 'primary' }, { committee_uid: 'secondary' }, { committee_uid: 'primary' }],
        'secondary'
      )
    ).toEqual(['secondary', 'primary']);
  });
});

describe('probeCommitteeWriters', () => {
  it('stops at the first writer without fetching the next committee', async () => {
    const fetch = vi.fn().mockReturnValue(of({ writer: true }));

    expect(await firstValueFrom(probeCommitteeWriters(['primary', 'secondary'], fetch))).toEqual({ writer: true, transientFailure: false });
    expect(fetch.mock.calls).toEqual([['primary']]);
  });

  it('waits for the primary verdict before admitting a secondary writer', async () => {
    const primary = new Subject<{ writer: boolean }>();
    const fetch = vi.fn((uid: string) => (uid === 'primary' ? primary : of({ writer: true })));
    const result = firstValueFrom(probeCommitteeWriters(['primary', 'secondary', 'third'], fetch));

    expect(fetch.mock.calls).toEqual([['primary']]);
    primary.next({ writer: false });
    expect(fetch.mock.calls).toEqual([['primary']]);
    primary.complete();

    expect(await result).toEqual({ writer: true, transientFailure: false });
    expect(fetch.mock.calls).toEqual([['primary'], ['secondary']]);
  });

  it('denies when no committee grants write access, including a null detail', async () => {
    const fetch = vi
      .fn()
      .mockReturnValueOnce(of(null))
      .mockReturnValue(of({ writer: false }));

    expect(await firstValueFrom(probeCommitteeWriters(['primary', 'secondary'], fetch))).toEqual({ writer: false, transientFailure: false });
    expect(fetch.mock.calls).toEqual([['primary'], ['secondary']]);
  });

  it('reports a transient failure when all remaining committees deny access', async () => {
    const fetch = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })))
      .mockReturnValue(of({ writer: false }));

    expect(await firstValueFrom(probeCommitteeWriters(['primary', 'secondary'], fetch))).toEqual({ writer: false, transientFailure: true });
    expect(fetch.mock.calls).toEqual([['primary'], ['secondary']]);
  });

  it('lets a later writer override an earlier transient failure', async () => {
    const fetch = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })))
      .mockReturnValue(of({ writer: true }));

    expect(await firstValueFrom(probeCommitteeWriters(['primary', 'secondary'], fetch))).toEqual({ writer: true, transientFailure: false });
  });

  it('treats a forbidden committee as denial and continues probing', async () => {
    const fetch = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403 })))
      .mockReturnValue(of({ writer: false }));

    expect(await firstValueFrom(probeCommitteeWriters(['primary', 'secondary'], fetch))).toEqual({ writer: false, transientFailure: false });
    expect(fetch.mock.calls).toEqual([['primary'], ['secondary']]);
  });

  it('denies an empty candidate list without fetching', async () => {
    const fetch = vi.fn();

    expect(await firstValueFrom(probeCommitteeWriters([], fetch))).toEqual({ writer: false, transientFailure: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('resolveVoteCanManage', () => {
  const vote = { project_slug: 'synthetic-project', project_uid: 'project-uid', committee_uid: 'committee-uid' };

  it('grants a project writer without probing the committee', async () => {
    const getProjectStrict = vi.fn().mockReturnValue(of({ writer: true }));
    const fetchCommittee = vi.fn();

    await expect(firstValueFrom(resolveVoteCanManage(vote, getProjectStrict, fetchCommittee))).resolves.toBe(true);
    expect(getProjectStrict).toHaveBeenCalledWith('synthetic-project');
    expect(fetchCommittee).not.toHaveBeenCalled();
  });

  it('grants a committee writer who is not a project writer', async () => {
    const getProjectStrict = vi.fn().mockReturnValue(of({ writer: false }));
    const fetchCommittee = vi.fn().mockReturnValue(of({ writer: true }));

    await expect(firstValueFrom(resolveVoteCanManage(vote, getProjectStrict, fetchCommittee))).resolves.toBe(true);
    expect(fetchCommittee).toHaveBeenCalledWith('committee-uid');
  });

  it('falls back to the voter view when both checks fail, logging the project failure', async () => {
    const error = new HttpErrorResponse({ status: 500 });
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const getProjectStrict = vi.fn().mockReturnValue(throwError(() => error));
    const fetchCommittee = vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    try {
      await expect(firstValueFrom(resolveVoteCanManage(vote, getProjectStrict, fetchCommittee))).resolves.toBe(false);
      expect(logError).toHaveBeenCalledWith('Failed to check project write access for vote', error);
    } finally {
      logError.mockRestore();
    }
  });

  it('probes only the committee when the vote carries no project', async () => {
    const getProjectStrict = vi.fn();
    const fetchCommittee = vi.fn().mockReturnValue(of({ writer: true }));

    await expect(firstValueFrom(resolveVoteCanManage({ committee_uid: 'committee-uid' } as never, getProjectStrict, fetchCommittee))).resolves.toBe(true);
    expect(getProjectStrict).not.toHaveBeenCalled();
  });

  it('is not a manager without a project or committee to check', async () => {
    const getProjectStrict = vi.fn();
    const fetchCommittee = vi.fn();

    await expect(firstValueFrom(resolveVoteCanManage({} as never, getProjectStrict, fetchCommittee))).resolves.toBe(false);
    expect(fetchCommittee).not.toHaveBeenCalled();
  });
});
