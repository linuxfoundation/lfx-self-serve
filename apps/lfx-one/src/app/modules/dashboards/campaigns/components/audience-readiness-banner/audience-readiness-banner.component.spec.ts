// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AudienceReadinessAction, AudienceReadinessNotice } from '@lfx-one/shared/interfaces';

import { AudienceReadinessBannerComponent } from './audience-readiness-banner.component';

describe('AudienceReadinessBannerComponent', () => {
  let fixture: ComponentFixture<AudienceReadinessBannerComponent>;

  const WARN: AudienceReadinessNotice = {
    testId: 'notice-warn',
    tone: 'warn',
    title: 'Could not be checked',
    message: 'It may already have one.',
    action: { kind: 'retry-audience-read', label: 'Try again', testId: 'notice-warn-retry' },
  };
  const BUSY: AudienceReadinessNotice = { testId: 'notice-busy', tone: 'busy', message: 'Checking...' };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AudienceReadinessBannerComponent] }).compileComponents();
  });

  function render(notices: readonly AudienceReadinessNotice[]): HTMLElement {
    fixture = TestBed.createComponent(AudienceReadinessBannerComponent);
    fixture.componentRef.setInput('notices', notices);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders nothing when there is nothing to say', () => {
    expect(render([]).querySelector('[data-testid="campaigns-audience-readiness"]')).toBeNull();
  });

  it('shows the first notice and folds the rest away until asked', () => {
    const host = render([WARN, BUSY]);

    expect(host.querySelector('[data-testid="notice-warn"]')?.classList.contains('hidden')).toBe(false);
    expect(host.querySelector('[data-testid="notice-warn"]')?.getAttribute('role')).toBe('alert');
    expect(host.querySelector('[data-testid="notice-busy"]')?.classList.contains('hidden')).toBe(true);

    host.querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-readiness-toggle"]')?.click();
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="notice-busy"]')?.classList.contains('hidden')).toBe(false);
    expect(host.querySelector('[data-testid="campaigns-audience-readiness-toggle"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('offers no toggle for a single notice', () => {
    expect(render([BUSY]).querySelector('[data-testid="campaigns-audience-readiness-toggle"]')).toBeNull();
  });

  it("emits the notice's action", () => {
    const host = render([WARN]);
    const seen: AudienceReadinessAction[] = [];
    fixture.componentInstance.action.subscribe((action) => seen.push(action));

    host.querySelector<HTMLButtonElement>('[data-testid="notice-warn-retry"]')?.click();

    expect(seen).toEqual(['retry-audience-read']);
  });
});
