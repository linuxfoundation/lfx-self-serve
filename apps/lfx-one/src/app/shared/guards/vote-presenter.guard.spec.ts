// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteService } from '../services/vote.service';
import { votePresenterGuard } from './vote-presenter.guard';

describe('votePresenterGuard', () => {
  let fetchVote: ReturnType<typeof vi.fn>;
  let createUrlTree: ReturnType<typeof vi.fn>;

  const route = (id: string | null = 'v1'): ActivatedRouteSnapshot => ({ paramMap: convertToParamMap(id ? { id } : {}) }) as unknown as ActivatedRouteSnapshot;
  const run = (r = route()): Promise<boolean | UrlTree> =>
    firstValueFrom(TestBed.runInInjectionContext(() => votePresenterGuard(r, {} as RouterStateSnapshot)) as Observable<boolean | UrlTree>);

  beforeEach(() => {
    fetchVote = vi.fn();
    createUrlTree = vi.fn(
      (commands: string[], extras: { queryParams: { _notice: string } }) => ({ commands, notice: extras.queryParams._notice }) as unknown as UrlTree
    );
    TestBed.configureTestingModule({
      providers: [
        { provide: VoteService, useValue: { fetchVote } },
        { provide: Router, useValue: { createUrlTree } },
      ],
    });
  });

  it('allows a vote#writer using the uncached writer-inclusive read', async () => {
    fetchVote.mockReturnValue(of({ uid: 'v1', writer: true }));
    expect(await run()).toBe(true);
    expect(fetchVote).toHaveBeenCalledWith('v1', { includeWriter: true });
  });

  it('denies a non-writer with the access notice', async () => {
    fetchVote.mockReturnValue(of({ uid: 'v1', writer: false }));
    expect(await run()).toMatchObject({ commands: ['/votes'], notice: 'access' });
  });

  it('denies when the writer flag is absent', async () => {
    fetchVote.mockReturnValue(of({ uid: 'v1' }));
    expect(await run()).toMatchObject({ notice: 'access' });
  });

  it('treats 403/404 as access denied', async () => {
    fetchVote.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    expect(await run()).toMatchObject({ notice: 'access' });
  });

  it('reports a non-permission failure as an error notice', async () => {
    fetchVote.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
    expect(await run()).toMatchObject({ notice: 'error' });
  });

  it('denies when the route has no id', async () => {
    expect(await run(route(null))).toMatchObject({ notice: 'access' });
    expect(fetchVote).not.toHaveBeenCalled();
  });
});
