// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { SelectComponent } from '@components/select/select.component';
import { DEFAULT_ORG_SCOPE, ORG_SCOPE_CODE_ONLY_NOTE, ORG_SCOPE_LABEL, ORG_SCOPE_UNAVAILABLE_NOTE } from '@lfx-one/shared/constants';
import type { OrgScopeFilter, OrgScopeOption } from '@lfx-one/shared/interfaces';
import { orgScopeOptions, orgScopeTooltip, parseOrgScopeFilter } from '@lfx-one/shared/utils';
import { OrgLensOrgScopeService } from '@services/org-lens-org-scope.service';
import { map, of, startWith, switchMap } from 'rxjs';

/**
 * The Organization scope picker (lfx-self-serve-ops#1219) every Org Lens page with contributor counts shows, bound to
 * the page's `orgScope` control: Insights organization (default) or All related organizations (N). Its tooltip says what
 * the picked option counts, naming the account's Insights organization. An account with no Insights organization gets a
 * disabled select showing All related organizations and a note; the page's control is left alone, since the BFF serves
 * that account All related organizations whatever is asked.
 */
@Component({
  selector: 'lfx-org-scope-select',
  imports: [SelectComponent],
  templateUrl: './org-scope-select.component.html',
})
export class OrgScopeSelectComponent {
  private readonly orgScopeService = inject(OrgLensOrgScopeService);

  public readonly form = input.required<FormGroup>();
  public readonly control = input<string>('orgScope');
  public readonly dataTest = input<string>('org-scope-filter');
  /** People → All Employees: the pick changes code columns only, which the tooltip says. */
  public readonly codeOnly = input<boolean>(false);

  protected readonly label = ORG_SCOPE_LABEL;
  protected readonly unavailableNote = ORG_SCOPE_UNAVAILABLE_NOTE;
  protected readonly fallbackForm = new FormGroup({ orgScope: new FormControl<OrgScopeFilter>({ value: 'all', disabled: true }, { nonNullable: true }) });

  protected readonly unavailable = computed(() => this.orgScopeService.current()?.hasInsightsOrg === false);
  protected readonly options: Signal<OrgScopeOption[]> = computed(() => orgScopeOptions(this.orgScopeService.current()));

  private readonly value: Signal<OrgScopeFilter> = toSignal(
    toObservable(computed(() => this.form().get(this.control()))).pipe(
      switchMap((control) => (control ? control.valueChanges.pipe(startWith(control.value)) : of(DEFAULT_ORG_SCOPE))),
      map((value) => parseOrgScopeFilter(value) ?? DEFAULT_ORG_SCOPE)
    ),
    { initialValue: DEFAULT_ORG_SCOPE }
  );

  protected readonly tooltip = computed(() => {
    const text = orgScopeTooltip(this.unavailable() ? 'all' : this.value(), this.orgScopeService.current());
    return this.codeOnly() ? `${text} ${ORG_SCOPE_CODE_ONLY_NOTE}` : text;
  });
}
