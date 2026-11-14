// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';

import { RsvpScopeModalComponent } from './rsvp-scope-modal.component';

async function mount(canSelectOccurrence: boolean) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: DynamicDialogRef, useValue: { close } },
      {
        provide: DynamicDialogConfig,
        useValue: {
          data: {
            response: 'Not going',
            occurrenceLabel: canSelectOccurrence ? 'Fri, Jan 2, 2099 · 10:00 AM UTC' : null,
            canSelectOccurrence,
          },
        },
      },
    ],
  });
  TestBed.overrideComponent(RsvpScopeModalComponent, { set: { template: '', imports: [] } });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(RsvpScopeModalComponent);
  fixture.detectChanges();
  return { component: fixture.componentInstance, close };
}

describe('RsvpScopeModalComponent — date scope selection', () => {
  it('defaults to only the resolved date and preserves the all-dates and following-dates choices', async () => {
    const { component, close } = await mount(true);
    expect(component.scopeForm.controls.scope.value).toBe('single');
    expect(component.scopeOptions.map((option) => option.value)).toEqual(['single', 'all', 'this_and_following']);
    component.onConfirm();
    expect(close).toHaveBeenCalledWith({ confirmed: true, scope: 'single' });
  });

  it('returns the all-dates choice only when the user explicitly selects it', async () => {
    const { component, close } = await mount(true);
    component.scopeForm.controls.scope.setValue('all');
    component.onConfirm();
    expect(close).toHaveBeenCalledWith({ confirmed: true, scope: 'all' });
  });

  it('returns the supported following-dates choice without changing it to all dates', async () => {
    const { component, close } = await mount(true);
    component.scopeForm.controls.scope.setValue('this_and_following');
    component.onConfirm();
    expect(close).toHaveBeenCalledWith({ confirmed: true, scope: 'this_and_following' });
  });

  it('does not allow a date-scoped confirmation without a resolved date', async () => {
    const { component, close } = await mount(false);
    expect(component.scopeOptions.map((option) => option.value)).toEqual(['all']);
    expect(component.scopeForm.controls.scope.value).toBe('all');
    component.scopeForm.controls.scope.setValue('single');
    component.onConfirm();
    expect(close).not.toHaveBeenCalled();
    component.scopeForm.controls.scope.setValue('all');
    component.onConfirm();
    expect(close).toHaveBeenCalledWith({ confirmed: true, scope: 'all' });
  });

  it('cancels without returning a response scope', async () => {
    const { component, close } = await mount(true);
    component.onCancel();
    expect(close).toHaveBeenCalledWith({ confirmed: false });
  });
});
