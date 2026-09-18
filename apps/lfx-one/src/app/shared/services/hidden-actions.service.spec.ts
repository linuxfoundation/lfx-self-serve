// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import type { PendingActionItem } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieRegistryService } from './cookie-registry.service';
import { HiddenActionsService } from './hidden-actions.service';

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

  beforeEach(() => {
    check = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        HiddenActionsService,
        { provide: SsrCookieService, useValue: { check, set: vi.fn() } },
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
});
