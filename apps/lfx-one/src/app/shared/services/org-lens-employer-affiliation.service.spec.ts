// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OrgLensEmployerAffiliation } from '@lfx-one/shared/interfaces';
import { Observable, Subject, throwError } from 'rxjs';
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
}

interface SetupOptions {
  /** The request fails instead of staying in flight. */
  failing?: boolean;
  staff?: boolean;
  holdsOrg?: boolean;
  /** False leaves the grants lookup unanswered. */
  grantsLoaded?: boolean;
}

function setup({ failing = false, staff = false, holdsOrg = false, grantsLoaded = true }: SetupOptions = {}): Harness {
  const loaded = signal(grantsLoaded);
  const isStaff = signal(staff);
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
      { provide: OrgRoleGrantsService, useValue: { loaded, isStaff } },
      { provide: AccountContextService, useValue: { hasOrgSelectorAccess } },
      { provide: UserService, useValue: { workExperienceRevision } },
    ],
  });

  const harness = { service: TestBed.inject(OrgLensEmployerAffiliationService), loaded, isStaff, hasOrgSelectorAccess, get, answers, workExperienceRevision };
  flush();
  return harness;
}

/** `toObservable` drives the probe from an effect, so nothing is asked until effects run. */
function flush(): void {
  TestBed.tick();
}

function affiliation(partial: Partial<OrgLensEmployerAffiliation> = {}): OrgLensEmployerAffiliation {
  return { employerName: 'Bank Pekao', accountId: null, hasActiveMembership: false, ...partial };
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
    h.answers[0].next(affiliation({ employerName: 'Bank Pekao', hasActiveMembership: false }));

    expect(h.service.pending()).toBe(false);
    expect(h.service.employerName()).toBe('Bank Pekao');
    expect(h.service.affiliatedToNonMember()).toBe(true);
    expect(h.service.lookupFailed()).toBe(false);
  });

  it('does not report a member employer as a non-member', () => {
    h = setup();
    h.answers[0].next(affiliation({ employerName: 'ServiceNow', hasActiveMembership: true }));

    expect(h.service.employerName()).toBe('ServiceNow');
    expect(h.service.affiliatedToNonMember()).toBe(false);
  });

  it('does not report a caller with no employer as affiliated to a non-member', () => {
    h = setup();
    h.answers[0].next(affiliation({ employerName: null, hasActiveMembership: false }));

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
    h.answers[0].next(affiliation({ employerName: 'Bank Pekao', hasActiveMembership: false }));
    expect(h.service.affiliatedToNonMember()).toBe(true);

    h.workExperienceRevision.update((revision) => revision + 1);
    flush();

    expect(h.get).toHaveBeenCalledTimes(2);
    expect(h.service.pending()).toBe(true);
    h.answers[1].next(affiliation({ employerName: 'ServiceNow', hasActiveMembership: true }));
    expect(h.service.affiliatedToNonMember()).toBe(false);
    expect(h.service.employerName()).toBe('ServiceNow');
  });

  it('re-asks on refresh, so the shared Retry covers the employer half', () => {
    h = setup();
    h.answers[0].next(affiliation());

    h.service.refresh();
    flush();

    expect(h.get).toHaveBeenCalledTimes(2);
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
