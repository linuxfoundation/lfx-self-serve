// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { datadogRum } from '@datadog/browser-rum';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { DataDogRumService } from './datadog-rum.service';

/**
 * Pins where the Admin Mode impersonation gate lives. setUser() assigns the impersonated user's
 * identity to the RUM session, so an admin's clicks are attributed to that user — product funnels
 * (e.g. the ID migration funnel) would silently absorb admin traffic. The suppression has to be a
 * property of the service, not a check each caller remembers: a call site that forgets it corrupts
 * the funnel with no visible failure. addError is deliberately NOT gated — errors are session
 * telemetry, not user-attributed product events, and an impersonated session's errors are real.
 */
describe('DataDogRumService — impersonation suppression', () => {
  let service: DataDogRumService;
  let addAction: MockInstance<typeof datadogRum.addAction>;
  let addError: MockInstance<typeof datadogRum.addError>;

  beforeEach(() => {
    // The SDK singleton is spied rather than module-mocked: these specs run through the Angular
    // builder's bundle, where vi.mock() hoisting does not reach the already-bundled import.
    addAction = vi.spyOn(datadogRum, 'addAction').mockImplementation(() => undefined);
    addError = vi.spyOn(datadogRum, 'addError').mockImplementation(() => undefined);

    TestBed.configureTestingModule({ providers: [DataDogRumService] });
    service = TestBed.inject(DataDogRumService);
  });

  afterEach(() => {
    addAction.mockRestore();
    addError.mockRestore();
  });

  it('forwards addAction with its name and context by default', () => {
    service.addAction('migration_id_continue', { funnel: 'id_lfx_migration' });

    expect(addAction).toHaveBeenCalledWith('migration_id_continue', { funnel: 'id_lfx_migration' });
  });

  it('suppresses addAction while impersonating', () => {
    service.setImpersonating(true);

    service.addAction('migration_id_continue', { funnel: 'id_lfx_migration' });

    expect(addAction).not.toHaveBeenCalled();
  });

  it('still reports addError while impersonating', () => {
    service.setImpersonating(true);
    const error = new Error('upstream failed');

    service.addError(error, { source: 'test' });

    expect(addError).toHaveBeenCalledWith(error, { source: 'test' });
  });

  it('resumes addAction once impersonation ends', () => {
    service.setImpersonating(true);
    service.setImpersonating(false);

    service.addAction('migration_id_link_click');

    expect(addAction).toHaveBeenCalledWith('migration_id_link_click', undefined);
  });
});
