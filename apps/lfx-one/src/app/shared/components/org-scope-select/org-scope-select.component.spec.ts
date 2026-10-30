// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { SelectComponent } from '@components/select/select.component';
import { ORG_SCOPE_ALL_TOOLTIP, ORG_SCOPE_CODE_ONLY_NOTE, ORG_SCOPE_UNAVAILABLE_NOTE } from '@lfx-one/shared/constants';
import type { OrgLensOrgScope, OrgScopeFilter } from '@lfx-one/shared/interfaces';
import { OrgLensOrgScopeService } from '@services/org-lens-org-scope.service';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { OrgScopeSelectComponent } from './org-scope-select.component';

const SCOPE: OrgLensOrgScope = {
  accountId: 'acc-1',
  hasInsightsOrg: true,
  insightsOrgId: 'insights-1',
  insightsOrgName: 'Example Org',
  relatedOrgCount: 4,
};

describe('OrgScopeSelectComponent', () => {
  let fixture: ComponentFixture<OrgScopeSelectComponent>;
  let current: WritableSignal<OrgLensOrgScope | null>;
  let retryFailedRead: Mock<() => void>;
  let form: FormGroup<{ orgScope: FormControl<OrgScopeFilter> }>;

  const select = (): SelectComponent => fixture.debugElement.query(By.directive(SelectComponent)).componentInstance;
  const el = (): HTMLElement => fixture.nativeElement;

  async function mount({ info = SCOPE as OrgLensOrgScope | null, codeOnly = false } = {}): Promise<void> {
    current.set(info);
    await TestBed.configureTestingModule({
      imports: [OrgScopeSelectComponent],
      providers: [{ provide: OrgLensOrgScopeService, useValue: { current, retryFailedRead } }],
    }).compileComponents();
    fixture = TestBed.createComponent(OrgScopeSelectComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('dataTest', 'page-org-scope');
    fixture.componentRef.setInput('codeOnly', codeOnly);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    current = signal<OrgLensOrgScope | null>(null);
    retryFailedRead = vi.fn();
    form = new FormGroup({ orgScope: new FormControl<OrgScopeFilter>('insights', { nonNullable: true }) });
  });

  it("binds the page's control, offering the Insights organization and All related organizations with the count", async () => {
    await mount();

    expect(select().form()).toBe(form);
    expect(select().control()).toBe('orgScope');
    expect(select().options()).toEqual([
      { label: 'Insights organization', value: 'insights' },
      { label: 'All related organizations (4)', value: 'all' },
    ]);
  });

  it('leaves the count off All related organizations while the account scope is unknown', async () => {
    await mount({ info: null });

    expect(
      select()
        .options()
        .map((option: { label: string }) => option.label)
    ).toEqual(['Insights organization', 'All related organizations']);
  });

  it('names the Insights organization in the tooltip under insights, and says every related organization under all', async () => {
    await mount();

    expect(select().tooltip()).toContain('Counts only Example Org');

    form.controls.orgScope.setValue('all');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(select().tooltip()).toBe(ORG_SCOPE_ALL_TOOLTIP);
  });

  it('says the pick applies to code contributions only when codeOnly', async () => {
    await mount({ codeOnly: true });

    expect(select().tooltip()).toMatch(new RegExp(`${ORG_SCOPE_CODE_ONLY_NOTE.replace('.', '\\.')}$`));
    expect(select().tooltip()).toContain('Counts only Example Org');
  });

  it('shows a disabled All related organizations and a note when the account has no Insights organization, leaving the page control alone', async () => {
    await mount({ info: { ...SCOPE, hasInsightsOrg: false, insightsOrgId: null, insightsOrgName: null } });

    expect(select().form()).not.toBe(form);
    expect(select().form().get('orgScope')?.value).toBe('all');
    expect(select().form().get('orgScope')?.disabled).toBe(true);
    expect(select().tooltip()).toBe(ORG_SCOPE_ALL_TOOLTIP);
    expect(el().querySelector('[data-testid="page-org-scope-unavailable"]')?.textContent?.trim()).toBe(ORG_SCOPE_UNAVAILABLE_NOTE);
    expect(form.controls.orgScope.value).toBe('insights');
    expect(form.controls.orgScope.enabled).toBe(true);
  });

  it('shows no unavailable note while the account has an Insights organization', async () => {
    await mount();

    expect(el().querySelector('[data-testid="page-org-scope-unavailable"]')).toBeNull();
  });

  it('asks the scope service to retry a failed metadata read when it is created', async () => {
    await mount({ info: null });

    expect(retryFailedRead).toHaveBeenCalledTimes(1);
  });
});
