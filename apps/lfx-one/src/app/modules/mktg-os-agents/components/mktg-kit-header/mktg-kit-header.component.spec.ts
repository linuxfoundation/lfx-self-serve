// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MktgKitHeaderComponent } from './mktg-kit-header.component';

describe('Shared Marketing kit header', () => {
  it('keeps project context and optionally renders the board description', async () => {
    TestBed.configureTestingModule({ imports: [MktgKitHeaderComponent] });
    const fixture = TestBed.createComponent(MktgKitHeaderComponent);
    fixture.componentRef.setInput('projectName', 'Synthetic Project');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Marketing kit');
    expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Synthetic Project');
    fixture.componentRef.setInput('withDescription', true);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Every asset the project runs on');
  });
});
