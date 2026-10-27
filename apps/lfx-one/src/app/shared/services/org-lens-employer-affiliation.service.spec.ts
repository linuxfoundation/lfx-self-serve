// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OrgLensEmployerAffiliation } from '@lfx-one/shared/interfaces';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { AccountContextService } from './account-context.service';
import { OrgLensEmployerAffiliationService } from './org-lens-employer-affiliation.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { UserService } from './user.service';

interface Harness {
  service: OrgLensEmployerAffiliationService;
  loaded: WritableSignal<boolean>;
  isStaff: WritableSignal<boolean>;
  hasOrgSelectorAccess: WritableSignal<boolean>;
  get: Mock<(url: string) => Observable<OrgLensEmployerAffiliation>>;
  /** The in-flight request's subject, one per call. */
  answers: Subject<OrgLensEmployerAffiliation>[];
  /** `UserService.workExperienceRevision` — bumped by a profile work-experience write. */
  workExperienceRevision: WritableSignal<number>;
  /** #4225's verdict, which rule 6 of the classifier reads before anything this service answers. */
  affiliatedToMember: WritableSignal<boolean>;
  /** `OrgRoleGrantsService.refresh`, which re-asks that verdict. */
  refreshGrants: Mock<(bypassCache?: boolean) => Observable<void>>;
}

interface SetupOptions {
  /** The request fails instead of staying in flight. */
  failing?: boolean;
  staff?: boolean;
  holdsOrg?: boolean;
  /** The server already established the caller works for an LF member org (#4225). */
  memberEmployer?: boolean;
  /** False leaves the grants lookup unanswered. */
  grantsLoaded?: boolean;
}

function setup({ failing = false, staff = false, holdsOrg = false, grantsLoaded = true, memberEmployer = false }: SetupOptions = {}): Harness {
  const loaded = signal(grantsLoaded);
  const isStaff = signal(staff);
  const affiliatedToMember = signal(memberEmployer);
  const refreshGrants: Mock<(bypassCache?: boolean) => Observable<void>> = vi.fn(() => of(undefined));
  const hasOrgSelectorAccess = signal(holdsOrg);
  const answers: Subject<OrgLensEmployerAffiliation>[] = [];
  const workExperienceRevision = signal(0);
  const get: Mock<(url: string) => Observable<OrgLensEmployerAffiliation>> = vi.fn(() => {
    if (failing) {
      return throwError(() => new Error('upstream down'));
    }
    const answer = new Subject<OrgLensEmployerAffiliation>();
    answers.push(answer);
    return answer.asObservable();
  });

  TestBed.configureTestingModule({
    providers: [
      { provide: HttpClient, useValue: { get } },
      { provide: OrgRoleGrantsService, useValue: { loaded, isStaff, affiliatedToMember, refresh: refreshGrants } },
      { provide: AccountContextService, useValue: { hasOrgSelectorAccess } },
      { provide: UserService, useValue: { workExperienceRevision } },
    ],
  });

  const harness = {
    service: TestBed.inject(OrgLensEmployerAffiliationService),
    loaded,
    isStaff,
    hasOrgSelectorAccess,
    get,
    answers,
    workExperienceRevision,
    affiliatedToMember,
    refreshGrants,
  };
  flush();
  return harness;
}

/** `toObservable` drives the probe from an effect, so nothing is asked until effects run. */
function flush(): void {
  TestBed.tick();
}

function affiliation(partial: Partial<OrgLensEmployerAffiliation> = {}): OrgLensEmployerAffiliation {
  return { employerName: 'Delta Harbour', membership: 'non-member', ...partial };
}

describe('OrgLensEmployerAffiliationService', () => {
  let h: Harness;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('asks only once the grants lookup has answered and the caller holds nothing', () => {
    h = setup();
    expect(h.service.pending()).toBe(true);
    expect(h.get).toHaveBeenCalledWith('/api/profile/employer-affiliation');
  });

  // #4225 answers rule 6 before this probe is read, so asking would buy nothing and cost a CDP round
  // trip plus a Snowflake query for the population least likely to have a CDP profile at all.
  it('never asks when the member-employer verdict is already established', () => {
    h = setup({ memberEmployer: true });

    expect(h.get).not.toHaveBeenCalled();
    expect(h.service.pending()).toBe(false);
    expect(h.service.affiliatedToNonMember()).toBe(false);
  });

  // The verdict is cached server-side and derived from the same work history, so an edit must
  // invalidate it too — otherwise rule 6 keeps answering from the old employer and this probe's
  // answer is never reached.
  it('re-asks the member-employer verdict, cache bypassed, after a work-history edit', () => {
    h = setup({ memberEmployer: true });
    expect(h.refreshGrants).not.toHaveBeenCalled();

    h.workExperienceRevision.set(1);
    flush();

    expect(h.refreshGrants).toHaveBeenCalledWith(true);
  });

  // The whole transition the finding describes: member employer replaced by a non-member one.
  it('starts asking once a refreshed verdict clears the member employer', () => {
    h = setup({ memberEmployer: true });

    h.workExperienceRevision.set(1);
    h.affiliatedToMember.set(false);
    flush();

    expect(h.get).toHaveBeenCalledWith('/api/profile/employer-affiliation');
    h.answers[0].next(affiliation());
    expect(h.service.affiliatedToNonMember()).toBe(true);
  });

  // Nobody outside the population has a verdict worth re-asking, so an edit must not spend a
  // cache-bypassing round trip on them.
  it('leaves the member-employer verdict alone for a caller who holds an organization', () => {
    h = setup({ holdsOrg: true });

    h.workExperienceRevision.set(1);
    flush();

    expect(h.refreshGrants).not.toHaveBeenCalled();
  });

  it('never asks for a caller who holds an organization', () => {
    h = setup({ holdsOrg: true });

    expect(h.get).not.toHaveBeenCalled();
    expect(h.service.pending()).toBe(false);
    expect(h.service.affiliatedToNonMember()).toBe(false);
  });

  it('never asks for staff', () => {
    h = setup({ staff: true });

    expect(h.get).not.toHaveBeenCalled();
  });

  it('never asks before the grants lookup has answered', () => {
    h = setup({ grantsLoaded: false });

    expect(h.get).not.toHaveBeenCalled();
    expect(h.service.pending()).toBe(false);
  });

  it('reports a non-member employer once the answer lands', () => {
    h = setup();
    h.answers[0].next(affiliation({ employerName: 'Delta Harbour', membership: 'non-member' }));

    expect(h.service.pending()).toBe(false);
    expect(h.service.employerName()).toBe('Delta Harbour');
    expect(h.service.affiliatedToNonMember()).toBe(true);
    expect(h.service.lookupFailed()).toBe(false);
  });

  it('does not report a member employer as a non-member', () => {
    h = setup();
    h.answers[0].next(affiliation({ employerName: 'Vendor Corp', membership: 'member' }));

    expect(h.service.employerName()).toBe('Vendor Corp');
    expect(h.service.affiliatedToNonMember()).toBe(false);
  });

  it('does not report a caller with no employer as affiliated to a non-member', () => {
    h = setup();
    h.answers[0].next(affiliation({ employerName: null, membership: 'non-member' }));

    expect(h.service.employerName()).toBeNull();
    expect(h.service.affiliatedToNonMember()).toBe(false);
  });

  // The probe is driven from an effect, so there is a tick where `needed` is true and the probe has
  // not started. Reading that as settled would flash the "add an affiliation" copy.
  it('counts an unstarted probe as pending, not as settled', () => {
    h = setup({ grantsLoaded: false });
    h.loaded.set(true);

    // No flush: this is exactly the gap between `needed` turning true and the effect running.
    expect(h.service.pending()).toBe(true);
    expect(h.service.affiliatedToNonMember()).toBe(false);
  });

  // The state's own CTA sends the caller to the profile to change this answer; a root-provided service
  // outlives that round trip, so the old answer must not survive it.
  it('re-asks after a profile work-experience write', () => {
    h = setup();
    h.answers[0].next(affiliation({ employerName: 'Delta Harbour', membership: 'non-member' }));
    expect(h.service.affiliatedToNonMember()).toBe(true);

    h.workExperienceRevision.update((revision) => revision + 1);
    flush();

    expect(h.get).toHaveBeenCalledTimes(2);
    expect(h.service.pending()).toBe(true);
    h.answers[1].next(affiliation({ employerName: 'Vendor Corp', membership: 'member' }));
    expect(h.service.affiliatedToNonMember()).toBe(false);
    expect(h.service.employerName()).toBe('Vendor Corp');
  });

  it('re-asks on refresh, so the shared Retry covers the employer half', () => {
    h = setup();
    h.answers[0].next(affiliation());

    h.service.refresh();
    flush();

    expect(h.get).toHaveBeenCalledTimes(2);
  });

  // `unresolved` is the server saying it could not match the employer to an account. It is an unknown
  // like a failed request, not a negative, so it must not render the non-member copy either.
  it('does not treat an unresolved employer as a non-member', () => {
    h = setup();
    h.answers[0].next(affiliation({ employerName: 'Delta Harbour', membership: 'unresolved' }));

    expect(h.service.employerName()).toBe('Delta Harbour');
    expect(h.service.affiliatedToNonMember()).toBe(false);
  });

  // A failed lookup is "unknown", never "not a member" — the copy would otherwise assert something
  // about a company nobody checked.
  it('treats a failed lookup as unknown rather than non-member', () => {
    h = setup({ failing: true });

    expect(h.service.lookupFailed()).toBe(true);
    expect(h.service.pending()).toBe(false);
    expect(h.service.affiliatedToNonMember()).toBe(false);
  });
});
