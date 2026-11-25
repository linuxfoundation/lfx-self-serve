// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Type, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CLA_GROUP_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import { SignIdentityDialogData } from '@lfx-one/shared/interfaces';
import { MyClasService } from '@services/my-clas.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountSignDialogContext } from '../account-sign-dialog-context';
import { AccountClaGroupStepComponent } from './account-cla-group-step.component';
import { AccountContractTypeStepComponent } from './account-contract-type-step.component';
import { AccountGitlabStepComponent } from './account-gitlab-step.component';
import { AccountIdentityStepComponent } from './account-identity-step.component';

describe('Account & Settings "Sign a CLA" steps', () => {
  async function render<T>(component: Type<T>, data: unknown = {}, pickedName = '') {
    const close = vi.fn();
    const context = { pickedName: signal(pickedName) };
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: AccountSignDialogContext, useValue: context },
        { provide: MyClasService, useValue: { getClaGroupOptions: vi.fn(() => of({ results: [], truncated: false })) } },
      ],
    });
    const fixture = TestBed.createComponent(component);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    const click = async (testId: string) => {
      (query(testId)?.querySelector('button') ?? query(testId))?.click();
      await fixture.whenStable();
    };
    return { fixture, host, query, click, close, context };
  }

  it('asks for the project, CLA group or repository first, and records the pick', async () => {
    const { fixture, query, close, context } = await render(AccountClaGroupStepComponent);
    expect(query('account-sign-cla-search')?.textContent).toContain('Project, CLA group or repository');

    const step = fixture.componentInstance;
    const option = { claGroupId: 'cg-1', primaryName: 'Project One', secondaryName: null, matchTypeLabels: [], orgViews: [], expanded: false };
    step['onSelect'](option as never);
    step['onContinue']();

    expect(context.pickedName()).toBe('Project One');
    expect(close).toHaveBeenCalledWith(option);
  });

  it('names the search that found nothing only once it has run', async () => {
    const { fixture, query } = await render(AccountClaGroupStepComponent);
    fixture.componentInstance['searchForm'].controls.query.setValue('kube');
    await fixture.whenStable();
    expect(query('account-sign-cla-no-match')).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, CLA_GROUP_SEARCH_DEBOUNCE_MS + 50));
    await fixture.whenStable();
    expect(query('account-sign-cla-no-match')?.textContent).toContain('No CLA groups match “kube”.');

    // Shortened below the minimum, then retyped: the earlier answer is no longer the one shown.
    fixture.componentInstance['searchForm'].controls.query.setValue('ku');
    await new Promise((resolve) => setTimeout(resolve, CLA_GROUP_SEARCH_DEBOUNCE_MS + 50));
    fixture.componentInstance['searchForm'].controls.query.setValue('kube');
    await fixture.whenStable();
    expect(query('account-sign-cla-no-match')).toBeNull();
  });

  it('lets the field carry the results list and its highlighted option', async () => {
    const { fixture, host } = await render(AccountClaGroupStepComponent);
    fixture.componentInstance['searchForm'].controls.query.setValue('kube');
    await fixture.whenStable();
    const field = host.querySelector('[data-testid="ui-input"]') as HTMLInputElement;

    expect(field.getAttribute('role')).toBe('combobox');
    expect(field.getAttribute('aria-controls')).toBe('account-sign-cla-results');
    expect(field.getAttribute('aria-expanded')).toBe('true');
  });

  it('asks which contributor type, and continues with the one picked', async () => {
    const { fixture, query, close } = await render(AccountContractTypeStepComponent, { heldKinds: ['ICLA'] });
    const individual = query('account-sign-cla-contract-individual')?.querySelector('input') as HTMLInputElement;
    expect(individual.getAttribute('aria-disabled')).toBe('true');

    (query('account-sign-cla-contract-corporate')?.querySelector('input') as HTMLInputElement).click();
    await fixture.whenStable();
    query('account-sign-cla-contract-continue')?.querySelector('button')?.click();

    expect(close).toHaveBeenCalledWith({ contractType: expect.any(String) });
  });

  it('asks which identity to sign the picked CLA group as, then continues to sign', async () => {
    const data: SignIdentityDialogData = { variant: 'github', accounts: [{ githubId: '42', githubUsername: 'ada' }] };
    const { fixture, query, close } = await render(AccountIdentityStepComponent, data, 'Project One');
    expect(query('account-sign-cla-identities')?.parentElement?.textContent).toContain('Sign Project One as');
    expect(query('account-sign-cla-identity-42')?.textContent).toContain('For repositories on GitHub');

    (query('account-sign-cla-identity-42')?.querySelector('input') as HTMLInputElement).click();
    await fixture.whenStable();
    query('account-sign-cla-identity-continue')?.querySelector('button')?.click();

    expect(close).toHaveBeenCalledWith({ kind: 'github', githubId: '42' });
  });

  it('sends someone with no identity to sign with to Identities', async () => {
    const data: SignIdentityDialogData = { variant: 'github', accounts: [] };
    const { query, click, close } = await render(AccountIdentityStepComponent, data);
    expect(query('account-sign-cla-identity-empty')).not.toBeNull();

    await click('account-sign-cla-identity-link');
    expect(close).toHaveBeenCalledWith({ linkAccounts: true });
  });

  it('says a GitLab-only CLA group can’t be signed here', async () => {
    const { query, click, close } = await render(AccountGitlabStepComponent);
    expect(query('account-sign-cla-gitlab')?.textContent).toContain('GitLab');

    await click('account-sign-cla-gitlab-close');
    expect(close).toHaveBeenCalledWith(null);
  });
});
