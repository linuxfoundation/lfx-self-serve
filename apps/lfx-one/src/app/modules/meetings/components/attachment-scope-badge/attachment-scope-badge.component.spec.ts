// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { AttachmentScopeBadgeComponent } from './attachment-scope-badge.component';

describe('AttachmentScopeBadgeComponent', () => {
  let fixture: ComponentFixture<AttachmentScopeBadgeComponent>;

  const badge = (): HTMLElement => fixture.nativeElement.querySelector('[data-testid="attachment-scope-badge"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AttachmentScopeBadgeComponent] }).compileComponents();
    fixture = TestBed.createComponent(AttachmentScopeBadgeComponent);
  });

  it('labels an occurrence-scoped attachment "This occurrence"', async () => {
    fixture.componentRef.setInput('scope', 'occurrence');
    await fixture.whenStable();

    expect(badge().textContent?.trim()).toBe('This occurrence');
    expect(badge().getAttribute('data-scope')).toBe('occurrence');
  });

  it('labels a series-wide attachment "All occurrences"', async () => {
    fixture.componentRef.setInput('scope', 'series');
    await fixture.whenStable();

    expect(badge().textContent?.trim()).toBe('All occurrences');
    expect(badge().getAttribute('data-scope')).toBe('series');
  });
});
