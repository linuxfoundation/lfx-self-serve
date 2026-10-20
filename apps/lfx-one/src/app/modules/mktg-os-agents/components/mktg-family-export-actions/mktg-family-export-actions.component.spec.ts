// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MktgFamilyExportActionsComponent } from './mktg-family-export-actions.component';

describe('Family export integration slot', () => {
  it('takes the family id and renders two inert actions with stable ids', async () => {
    TestBed.configureTestingModule({ imports: [MktgFamilyExportActionsComponent] });
    const fixture = TestBed.createComponent(MktgFamilyExportActionsComponent);
    fixture.componentRef.setInput('familyId', 'positioning-brand');
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.getAttribute('data-family-id')).toBe('positioning-brand');
    expect(root.textContent).toContain('Coming soon');
    expect(root.textContent).toContain('Everything is rendered in the app');
    expect(root.querySelectorAll('button')).toHaveLength(2);
    for (const id of ['family-export-pdf', 'family-export-slides']) {
      expect(root.querySelector<HTMLButtonElement>(`[data-testid="${id}"] button`)?.disabled).toBe(true);
    }
    expect(root.querySelector('a')).toBeNull();
    fixture.componentRef.setInput('familyId', 'website-web');
    await fixture.whenStable();
    expect(root.getAttribute('data-family-id')).toBe('website-web');
  });
});
