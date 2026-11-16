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

  it.each([['/org/family-0014100000RootAAAA/people'], ['/org/family-0014100000RootAAAA/roi/projects/k8s'], ['/org/FAMILY-0014100000RootAAAA/events']])(
    'matches a roll-up address before the selection has adopted it (%s)',
    (url) => {
      expect(run(url)).toBe(true);
    }
  );

  // A cookie may still hold a roll-up while the address names one organization: the address wins.
  it('lets an addressed organization through, whatever the selection', () => {
    isRollUp.set(true);
    expect(run('/org/acme-inc/people')).toBe(false);
  });

  it('decides the legacy address from the restored selection', () => {
    expect(run('/org/people')).toBe(false);
    isRollUp.set(true);
    expect(run('/org/people')).toBe(true);
  });

  it('never matches outside Org Lens', () => {
    isRollUp.set(true);
    expect(run('/meetings')).toBe(false);
  });
});
