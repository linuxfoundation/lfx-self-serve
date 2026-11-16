// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, Router } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { AccountContextService } from '../services/account-context.service';
import { orgRollUpUnavailablePageGuard } from './org-rollup-unavailable-page.guard';

/**
 * #4133: on a family roll-up, a page that cannot render one yet shows the roll-up-unavailable state
 * instead of loading. The guard runs during recognition, before the roll-up address is adopted, so
 * it must decide from the address being recognized rather than from the selection.
 */
describe('orgRollUpUnavailablePageGuard', () => {
  const isRollUp = signal(false);
  let targetUrl = '/';

  beforeEach(() => {
    isRollUp.set(false);
    targetUrl = '/';
    TestBed.configureTestingModule({
      providers: [
        { provide: AccountContextService, useValue: { isRollUp } },
        { provide: Router, useValue: { getCurrentNavigation: () => ({ extractedUrl: new DefaultUrlSerializer().parse(targetUrl) }) } },
      ],
    });
  });

  const run = (url: string): boolean => {
    targetUrl = url;
    return TestBed.runInInjectionContext(() => orgRollUpUnavailablePageGuard({}, []) as boolean);
  };

  it.each([['/company/family-0014100000RootAAAA/people'], ['/company/family-0014100000RootAAAA/roi/projects/k8s'], ['/company/FAMILY-0014100000RootAAAA/events']])(
    'matches a roll-up address before the selection has adopted it (%s)',
    (url) => {
      expect(run(url)).toBe(true);
    }
  );

  // A cookie may still hold a roll-up while the address names one organization: the address wins.
  it('lets an addressed organization through, whatever the selection', () => {
    isRollUp.set(true);
    expect(run('/company/acme-inc/people')).toBe(false);
  });

  it('decides the legacy address from the restored selection', () => {
    expect(run('/company/people')).toBe(false);
    isRollUp.set(true);
    expect(run('/company/people')).toBe(true);
  });

  // A redirect off bare `/company` leaves the URL being recognized as `/company`, so it is selection-based as well.
  it('decides bare /company from the restored selection', () => {
    expect(run('/company')).toBe(false);
    isRollUp.set(true);
    expect(run('/company')).toBe(true);
  });

  it.each([['/company/%20FAMILY-0014100000RootAAAA%20/people'], ['/company/Family-0014100000RootAAAA']])(
    'normalizes the segment before the roll-up check (%s)',
    (url) => {
      expect(run(url)).toBe(true);
    }
  );

  it('never matches outside Org Lens', () => {
    isRollUp.set(true);
    expect(run('/meetings')).toBe(false);
  });
});
