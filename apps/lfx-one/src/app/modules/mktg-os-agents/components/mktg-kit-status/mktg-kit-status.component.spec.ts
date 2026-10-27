// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MktgKitAssetRow } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';
import { MktgKitStatusComponent } from './mktg-kit-status.component';

describe('Kit asset status', () => {
  it('renders every state and run counts with text, never only color', async () => {
    TestBed.configureTestingModule({ imports: [MktgKitStatusComponent] });
    const fixture = TestBed.createComponent(MktgKitStatusComponent);
    const row: MktgKitAssetRow = {
      asset: { id: 'synthetic', label: 'Synthetic', description: '' },
      state: 'approved',
      version: 2,
      monthlyCount: null,
      document: null,
      madeBy: '—',
      badge: '',
    };
    for (const [state, label] of [
      ['approved', 'Approved'],
      ['draft', 'Draft'],
      ['needs-rebuild', 'Needs rebuild'],
      ['missing', 'Not run yet'],
      ['coming-soon', 'Coming soon'],
    ] as const) {
      fixture.componentRef.setInput('row', { ...row, state });
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(label);
    }
    fixture.componentRef.setInput('row', { ...row, state: null, monthlyCount: 3 });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('3 this month');
  });
});
