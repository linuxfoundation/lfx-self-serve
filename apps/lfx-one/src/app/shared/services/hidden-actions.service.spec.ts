// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PendingActionItem } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieRegistryService } from './cookie-registry.service';
import { HiddenActionsService } from './hidden-actions.service';
import { UserService } from './user.service';

const rsvpRow: PendingActionItem = {
  type: 'RSVP',
  badge: 'CNCF',
  text: 'RSVP to TAG Security weekly',
  icon: '',
  severity: 'warn',
  buttonText: 'RSVP',
  meetingUid: 'meeting-1',
};
const formationRow: PendingActionItem = {
  type: 'FormationItem',
  badge: 'Acme Project',
  text: 'Complete legal review',
  icon: '',
  severity: 'accent',
  buttonText: 'View item',
  formationItemUid: 'item-1',
};

describe('HiddenActionsService', () => {
  let service: HiddenActionsService;
  let check: ReturnType<typeof vi.fn>;
  let set: ReturnType<typeof vi.fn>;
  let user: ReturnType<typeof signal<{ sub: string } | null>>;

  beforeEach(() => {
    check = vi.fn();
    set = vi.fn();
    user = signal<{ sub: string } | null>({ sub: 'auth0|reviewer-1' });
    TestBed.configureTestingModule({
      providers: [
        HiddenActionsService,
        { provide: SsrCookieService, useValue: { check, set } },
        { provide: UserService, useValue: { user } },
        { provide: CookieRegistryService, useValue: { registerCookie: vi.fn() } },
      ],
    });
    service = TestBed.inject(HiddenActionsService);
  });

  it('hides a row whose completion or dismiss cookie is present', () => {
    check.mockReturnValue(true);
    expect(service.isActionHidden(rsvpRow)).toBe(true);
  });

  it('shows a row with no cookie', () => {
    check.mockReturnValue(false);
    expect(service.isActionHidden(rsvpRow)).toBe(false);
  });

  // #2732: formation rows no longer offer Dismiss (they are resolved on the checklist), but a
  // dismiss cookie written while the button existed lives ~10 years — with no control left to undo
  // it, honouring it would hide that item forever. Cookies never hide a formation row.
  it('never hides a formation row, even when a dismiss cookie from before #2732 is present', () => {
    check.mockReturnValue(true);
    expect(service.isActionHidden(formationRow)).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('never cookie-hides a join application with an incomplete address, even when a cookie matches', () => {
    check.mockReturnValue(true);
    expect(service.isActionHidden({ ...rsvpRow, type: 'JoinApplication', committeeUid: undefined, applicationUid: undefined })).toBe(false);
    expect(service.isActionHidden({ ...rsvpRow, type: 'JoinApplication', committeeUid: 'group-1', applicationUid: undefined })).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('scopes a join-request dismissal to the effective user, so switching reviewers does not carry it over', () => {
    const row = { ...rsvpRow, type: 'JoinApplication' as const, committeeUid: 'group-1', applicationUid: 'application-1' };

    service.dismissAction(row);
    const reviewerOneCookie = set.mock.calls[0][0] as string;

    user.set({ sub: 'auth0|reviewer-2' });
    service.dismissAction(row);
    const reviewerTwoCookie = set.mock.calls[1][0] as string;
    expect(reviewerTwoCookie).not.toBe(reviewerOneCookie);

    // Only reviewer 1's cookie exists in the browser: reviewer 2 (e.g. an admin impersonating them) must still see the request.
    check.mockImplementation((name: string) => name === reviewerOneCookie);
    expect(service.isActionHidden(row)).toBe(false);
    user.set({ sub: 'auth0|reviewer-1' });
    expect(service.isActionHidden(row)).toBe(true);
  });

  it('neither writes nor honours a join-request dismissal when there is no effective user', () => {
    user.set(null);
    const row = { ...rsvpRow, type: 'JoinApplication' as const, committeeUid: 'group-1', applicationUid: 'application-1' };
    check.mockReturnValue(true);

    service.dismissAction(row);

    expect(set).not.toHaveBeenCalled();
    expect(service.isActionHidden(row)).toBe(false);
  });

  it('hides a complete join application only through its dismiss cookie, not the 24h completion cookie', () => {
    const row = { ...rsvpRow, type: 'JoinApplication' as const, committeeUid: 'group-1', applicationUid: 'application-1' };
    check.mockImplementation((name: string) => name.startsWith('lfx_hidden_'));
    expect(service.isActionHidden(row)).toBe(false);
    check.mockImplementation((name: string) => name.startsWith('lfx_dismissed_'));
    expect(service.isActionHidden(row)).toBe(true);
  });
});
