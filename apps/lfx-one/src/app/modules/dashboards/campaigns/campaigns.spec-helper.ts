// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ProjectContext } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeAll, beforeEach } from 'vitest';
import { CampaignsComponent } from './campaigns.component';

/**
 * Selects a foundation once before a spec file's suites run. The selection lives in a cookie that
 * outlives each TestBed, and these suites were written against one an earlier suite had left there.
 */
export function seedSelectedFoundation(foundation: ProjectContext): void {
  beforeAll(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MessageService, useValue: { add: () => undefined } },
        { provide: DialogService, useValue: { open: () => undefined } },
      ],
    });
    TestBed.inject(ProjectContextService).setFoundation(foundation, false);
    TestBed.resetTestingModule();
  });
}

/**
 * The real campaigns page with no DOM, for state-only tests (#5980).
 *
 * It is the same class, so every form, service, signal, computed and effect runs exactly as it does
 * on the full template, and `fixture.detectChanges()` still drives the same change-detection and
 * effect cycles. Only the template, and with it every child tab, is gone, so a test here must assert
 * on state (signals, forms, service calls and payloads), never on the DOM or on a child tab.
 *
 * A subclass with its own `@Component`, not `TestBed.overrideComponent` on the page: an override is
 * dropped after every test and forces a recompile each time, while this empty template compiles once.
 * The page declares no component-scoped providers, so none are redeclared.
 *
 * Keep DOM tests on `CampaignsComponent`. With no DOM, an "is absent" or "is null" query is trivially
 * true, so a test that asserts something is NOT rendered must stay on the full template.
 */
@Component({
  selector: 'lfx-campaigns-state-only',
  template: '',
})
export class StateOnlyCampaignsComponent extends CampaignsComponent {}

/**
 * Test option that mounts {@link StateOnlyCampaignsComponent} for that test: `it('…', STATE_ONLY, () => …)`.
 *
 * Marked per test rather than per describe so a converted test keeps its place, its name and its
 * setup. Only a test that asserts on state belongs here: no `nativeElement`, `debugElement`, query,
 * text or aria check, directly or through a helper, and no "is absent" check on the DOM.
 */
export const STATE_ONLY = { meta: { stateOnlyCampaigns: true } } as const;

let stateOnlyTest = false;

/**
 * Records whether the running test is marked {@link STATE_ONLY}; call once at the top of a spec file
 * that marks any. A root `beforeEach` runs before every `describe`'s own, so the suites' setup can
 * call {@link campaignsComponentUnderTest} without being handed the test.
 */
export function trackStateOnlyTests(): void {
  beforeEach(({ task }) => {
    stateOnlyTest = task.meta.stateOnlyCampaigns === true;
  });
}

/** The page class the running test mounts: the empty-template subclass under {@link STATE_ONLY}, otherwise the real page. */
export function campaignsComponentUnderTest(): Type<CampaignsComponent> {
  return stateOnlyTest ? StateOnlyCampaignsComponent : CampaignsComponent;
}

declare module 'vitest' {
  interface TaskMeta {
    /** Set by {@link STATE_ONLY}. */
    stateOnlyCampaigns?: boolean;
  }
}
