// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Account, OrgResolveResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgSlugResolverService } from '@shared/services/org-slug-resolver.service';
import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { orgPathParamGuard } from './org-path-param.guard';

// Spec 050 (lfx-self-serve#2570), contracts/web-org-url-scheme.md §2. Covers the branches a wrong
// address would silently survive: which selections short-circuit the resolver, what the canonical
// segment is (slug / SFID / reserved name — DR-007 §5), the FR-004 lowercase rewrite, and the
// FR-020 split between "the resolver could not answer" and "the resolver said no".
describe('orgPathParamGuard', () => {
  const UID_A = '0014100000MgaAAAAA';
  const UID_B = '0014100000MgbBBBBB';

  let platformId: string;
  let selectedAccount: WritableSignal<Account>;
  let setAccount: Mock;
  let clearAccount: Mock;
  let refreshCanonicalRecord: Mock;
  let resolve: Mock;
  let router: Router;

  const account = (overrides: Partial<Account>): Account => ({
    accountId: overrides.uid ?? '',
    accountName: 'Some Org',
    accountSlug: '',
    membershipTier: '',
    ...overrides,
  });
  const placeholder = account({ accountId: '' });

  const hit = (uid: string, slug: string | null, name = 'Resolved Org'): OrgResolveResponse => ({ uid, slug, name });

  const runGuard = async (orgSegment: string, url: string): Promise<boolean | UrlTree> => {
    const route = { paramMap: convertToParamMap({ orgSegment }) } as unknown as ActivatedRouteSnapshot;
    const state = { url } as RouterStateSnapshot;
    const result = TestBed.runInInjectionContext(() => orgPathParamGuard(route, state));
    if (typeof result === 'boolean' || !('subscribe' in (result as object))) {
      return result as boolean | UrlTree;
    }
    return firstValueFrom(result as Observable<boolean | UrlTree>);
  };

  /** Serialized URL of a redirect, or the literal `true` — one shape to assert on either outcome. */
  const outcome = async (orgSegment: string, url: string): Promise<string | true> => {
    const result = await runGuard(orgSegment, url);
    return result === true ? true : router.serializeUrl(result as UrlTree);
  };

  const httpError = (status: number) => throwError(() => new HttpErrorResponse({ status, url: '/api/orgs/resolve/x' }));

  beforeEach(() => {
    platformId = 'browser';
    selectedAccount = signal<Account>(placeholder);
    setAccount = vi.fn((next: Account) => selectedAccount.set(next));
    clearAccount = vi.fn(() => selectedAccount.set(placeholder));
    refreshCanonicalRecord = vi.fn().mockResolvedValue(undefined);
    resolve = vi.fn().mockReturnValue(of(null));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useFactory: () => platformId },
        { provide: AccountContextService, useValue: { selectedAccount, setAccount, clearAccount, refreshCanonicalRecord } },
        { provide: OrgSlugResolverService, useValue: { resolve } },
      ],
    });
    router = TestBed.inject(Router);
  });

  // FR-021 / SC-010: the server renders the addressed organization (or nothing), never redirects.
  describe('server render', () => {
    beforeEach(() => {
      platformId = 'server';
      selectedAccount.set(account({ uid: UID_A, slug: 'acme-inc' })); // the cookie organization
    });

    it('adopts the addressed organization so the initial HTML is not the cookie organization, without rewriting', async () => {
      resolve.mockReturnValue(of(hit(UID_B, 'bravo-llc', 'Bravo LLC')));
      expect(await outcome(UID_B, `/org/${UID_B}/projects`)).toBe(true);
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B, accountName: 'Bravo LLC' }));
    });

    it('renders no organization on a miss instead of redirecting or keeping the cookie organization', async () => {
      resolve.mockReturnValue(of(null));
      expect(await outcome('unknown-org', '/org/unknown-org/overview')).toBe(true);
      expect(clearAccount).toHaveBeenCalledTimes(1);
      expect(setAccount).not.toHaveBeenCalled();
    });

    it('renders no organization when the resolver cannot answer a slug, and the stub for an SFID', async () => {
      resolve.mockReturnValueOnce(httpError(503));
      expect(await outcome('bravo-llc', '/org/bravo-llc/overview')).toBe(true);
      expect(clearAccount).toHaveBeenCalledTimes(1);

      resolve.mockReturnValueOnce(httpError(503));
      expect(await outcome(UID_B, `/org/${UID_B}/overview`)).toBe(true);
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B, accountName: '' }));
    });

    it('does not round-trip for the already-selected organization', async () => {
      expect(await outcome(UID_A, `/org/${UID_A}/projects`)).toBe(true);
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  it('rejects an empty segment without resolving', async () => {
    expect(await outcome('   ', '/org/%20%20%20/overview')).toBe('/org/not-found');
    expect(resolve).not.toHaveBeenCalled();
  });

  describe('already-selected organization (no round trip)', () => {
    it('is a no-op when the address already uses the selected slug', async () => {
      selectedAccount.set(account({ uid: UID_A, slug: 'acme-inc' }));
      expect(await outcome('acme-inc', '/org/acme-inc/projects?tab=active#top')).toBe(true);
      expect(resolve).not.toHaveBeenCalled();
      expect(setAccount).not.toHaveBeenCalled();
    });

    it('rewrites the SFID form to the known slug, keeping child segments, query and fragment (FR-002)', async () => {
      selectedAccount.set(account({ uid: UID_A, slug: 'acme-inc' }));
      expect(await outcome(UID_A, `/org/${UID_A}/projects/abc?tab=active#top`)).toBe('/org/acme-inc/projects/abc?tab=active#top');
      expect(resolve).not.toHaveBeenCalled();
    });

    it('keeps the SFID form when the organization is known to have no slug', async () => {
      selectedAccount.set(account({ uid: UID_A, slug: null }));
      expect(await outcome(UID_A, `/org/${UID_A}/overview`)).toBe(true);
      expect(resolve).not.toHaveBeenCalled();
    });

    it('keeps the SFID form when the slug is a reserved page name, so a static route is never shadowed (DR-007 §5)', async () => {
      selectedAccount.set(account({ uid: UID_A, slug: 'overview' }));
      expect(await outcome(UID_A, `/org/${UID_A}/projects`)).toBe(true);
      expect(resolve).not.toHaveBeenCalled();
    });

    it('still resolves a cookie-restored stub whose slug is not known yet, so the SFID address can canonicalize', async () => {
      selectedAccount.set(account({ uid: UID_A })); // slug undefined: canonical fetch has not filled it
      resolve.mockReturnValue(of(hit(UID_A, 'acme-inc')));

      expect(await outcome(UID_A, `/org/${UID_A}/projects`)).toBe('/org/acme-inc/projects');
      expect(resolve).toHaveBeenCalledWith(UID_A, UID_A);
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_A, slug: 'acme-inc' }));
    });
  });

  describe('resolver answers', () => {
    it('adopts a hit and passes `prefer` as the current selection', async () => {
      selectedAccount.set(account({ uid: UID_A, slug: 'acme-inc' }));
      resolve.mockReturnValue(of(hit(UID_B, 'bravo-llc', 'Bravo LLC')));

      expect(await outcome('bravo-llc', '/org/bravo-llc/people')).toBe(true);
      expect(resolve).toHaveBeenCalledWith('bravo-llc', UID_A);
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B, accountId: UID_B, accountName: 'Bravo LLC', slug: 'bravo-llc' }));
      expect(refreshCanonicalRecord).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B }));
    });

    it('matches an upper-case slug case-insensitively and rewrites the address to lowercase (FR-004)', async () => {
      resolve.mockReturnValue(of(hit(UID_B, 'bravo-llc')));

      expect(await outcome('BRAVO-LLC', '/org/BRAVO-LLC/projects?tab=active#top')).toBe('/org/bravo-llc/projects?tab=active#top');
      expect(resolve).toHaveBeenCalledWith('bravo-llc', null);
    });

    it('canonicalizes encoded surrounding whitespace away, not just letter case', async () => {
      resolve.mockReturnValue(of(hit(UID_B, 'bravo-llc')));
      expect(await outcome(' bravo-llc ', '/org/%20bravo-llc%20/projects?x=1#top')).toBe('/org/bravo-llc/projects?x=1#top');
      expect(resolve).toHaveBeenCalledWith('bravo-llc', null);
    });

    it('rewrites a resolved SFID address to the slug form (FR-002)', async () => {
      resolve.mockReturnValue(of(hit(UID_B, 'bravo-llc')));
      expect(await outcome(UID_B, `/org/${UID_B}/people`)).toBe('/org/bravo-llc/people');
    });

    it('leaves a resolved SFID address alone when the organization has no slug or its slug is a page name', async () => {
      resolve.mockReturnValueOnce(of(hit(UID_B, null)));
      expect(await outcome(UID_B, `/org/${UID_B}/people`)).toBe(true);

      resolve.mockReturnValueOnce(of(hit(UID_B, 'people')));
      expect(await outcome(UID_B, `/org/${UID_B}/people`)).toBe(true);
    });

    it('lands on not-found for a miss (404/409 surface as null) without touching the selection (FR-024)', async () => {
      selectedAccount.set(account({ uid: UID_A, slug: 'acme-inc' }));
      resolve.mockReturnValue(of(null));

      expect(await outcome('unknown-org', '/org/unknown-org/overview')).toBe('/org/not-found');
      expect(setAccount).not.toHaveBeenCalled();
      expect(refreshCanonicalRecord).not.toHaveBeenCalled();
    });
  });

  describe('resolver failures (FR-020)', () => {
    it('lets an SFID address through on a 5xx by adopting a uid-only stub', async () => {
      selectedAccount.set(account({ uid: UID_A, slug: 'acme-inc' }));
      resolve.mockReturnValue(httpError(503));

      expect(await outcome(UID_B, `/org/${UID_B}/projects`)).toBe(true);
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B, accountName: '' }));
      expect(refreshCanonicalRecord).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B }));
    });

    it('lets an SFID address through on a network failure / timeout (status 0)', async () => {
      resolve.mockReturnValue(httpError(0));
      expect(await outcome(UID_B, `/org/${UID_B}/projects`)).toBe(true);
      expect(setAccount).toHaveBeenCalledWith(expect.objectContaining({ uid: UID_B }));
    });

    it('treats a 4xx as an answer, not an outage: an SFID address lands on not-found and no stub is adopted', async () => {
      selectedAccount.set(account({ uid: UID_A, slug: 'acme-inc' }));
      resolve.mockReturnValue(httpError(400));

      expect(await outcome(UID_B, `/org/${UID_B}/projects`)).toBe('/org/not-found');
      expect(setAccount).not.toHaveBeenCalled();
    });

    it('never trusts a slug address the resolver could not answer', async () => {
      resolve.mockReturnValue(httpError(503));
      expect(await outcome('bravo-llc', '/org/bravo-llc/projects')).toBe('/org/not-found');
      expect(setAccount).not.toHaveBeenCalled();
    });
  });
});
