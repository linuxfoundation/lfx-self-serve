// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { OrgRoiEmptyStateComponent } from './org-roi-empty-state.component';

describe('OrgRoiEmptyStateComponent', () => {
  // #5447: the not-estimated state is text only; no support control may come back.
  it('renders the not-estimated state with no link or support control', () => {
    const fixture = TestBed.createComponent(OrgRoiEmptyStateComponent);
    fixture.componentRef.setInput('reason', 'not-estimated');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="org-roi-empty-state-not-estimated"]')).not.toBeNull();
    expect(root.querySelector('button, a, [lfxOpenIntercom]')).toBeNull();
  });
});
