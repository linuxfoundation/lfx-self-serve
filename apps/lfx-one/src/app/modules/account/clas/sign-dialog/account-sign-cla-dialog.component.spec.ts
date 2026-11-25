// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA } from '@angular/cdk/dialog';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it } from 'vitest';

import { AccountSignClaDialogComponent } from './account-sign-cla-dialog.component';
import { AccountSignDialogContext } from './account-sign-dialog-context';

/** A stand-in step that shows what it was handed by injection. */
@Component({
  selector: 'lfx-test-sign-step',
  template:
    '<button data-testid="other">Other</button><div data-autofocus><button data-testid="step">{{ config.header }} · {{ context.pickedName() }}</button></div>',
})
class TestStepComponent {
  protected readonly config = inject(DynamicDialogConfig);
  protected readonly ref = inject(DynamicDialogRef);
  protected readonly context = inject(AccountSignDialogContext);
}

describe('AccountSignClaDialogComponent', () => {
  async function render() {
    const host = { step: signal<unknown>(null), pickedName: signal('Project One') };
    TestBed.configureTestingModule({ providers: [{ provide: DIALOG_DATA, useValue: host }] });
    const fixture = TestBed.createComponent(AccountSignClaDialogComponent);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    return { fixture, host, query: (testId: string) => element.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null };
  }

  it('shows it is busy between steps, with no way out until the flow moves on', async () => {
    const { query } = await render();

    expect(query('account-sign-cla-busy')?.textContent).toContain('Checking your linked accounts');
    expect(query('ui-modal-close')).toBeNull();
  });

  it('shows the current step under its heading, with its ref, config and the shared pick', async () => {
    const { fixture, host, query } = await render();
    host.step.set({ component: TestStepComponent, config: { header: 'Select a GitHub account' }, ref: new DynamicDialogRef() });
    await fixture.whenStable();

    expect(query('account-sign-cla-busy')).toBeNull();
    expect(query('step')?.textContent).toBe('Select a GitHub account · Project One');
    expect(query('account-sign-cla-dialog')?.textContent).toContain('Select a GitHub account');
    expect(query('ui-modal-close')).not.toBeNull();
  });

  it('moves focus to the step’s marked control, not the Close button before it', async () => {
    const { fixture, host, query } = await render();
    host.step.set({ component: TestStepComponent, config: { header: 'Sign a CLA' }, ref: new DynamicDialogRef() });
    await fixture.whenStable();

    expect(document.activeElement).toBe(query('step'));
  });
});
