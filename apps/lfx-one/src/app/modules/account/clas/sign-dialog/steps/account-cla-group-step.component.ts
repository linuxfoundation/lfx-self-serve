// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { UiInputCombobox } from '@lfx-one/shared/interfaces';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';

import { ClaGroupSelectComponent } from '../../../../profile/clas/cla-group-select.component';
import { AccountSignDialogContext } from '../account-sign-dialog-context';

/**
 * The first step of the Account & Settings "Sign a CLA" dialog (#6077): search for the project, CLA group or repository. It keeps
 * the hub picker's search, keyboard and already-signed rules by extending it, and records the pick for the steps after it.
 */
@Component({
  selector: 'lfx-account-cla-group-step',
  imports: [ReactiveFormsModule, UiBadgeComponent, UiButtonComponent, UiInputComponent, UiSpinnerComponent],
  templateUrl: './account-cla-group-step.component.html',
  host: { class: 'flex flex-col gap-[16px]' },
})
export class AccountClaGroupStepComponent extends ClaGroupSelectComponent {
  private readonly context = inject(AccountSignDialogContext);

  /** The term a finished search found nothing for, or `null` while the typed term is still being searched. */
  protected readonly noMatchQuery: Signal<string | null> = this.initNoMatchQuery();
  /** Focus stays in the field, so it carries the listbox's state and the highlighted option. */
  protected readonly combobox: Signal<UiInputCombobox> = this.initCombobox();

  protected override onContinue(): void {
    const option = this.selected();
    if (option) this.context.pickedName.set(option.primaryName);
    super.onContinue();
  }

  private initCombobox(): Signal<UiInputCombobox> {
    return computed(() => {
      // Only while its row is drawn: a selection closes the list but keeps the highlight.
      const highlighted = this.resultsOpen() && !this.error() ? this.options()[this.highlightedIndex()] : undefined;
      return {
        controls: 'account-sign-cla-results',
        expanded: this.resultsOpen(),
        activeDescendant: highlighted ? `account-sign-cla-option-${highlighted.claGroupId}` : null,
      };
    });
  }

  private initNoMatchQuery(): Signal<string | null> {
    return computed(() => {
      const query = this.query().trim();
      return !this.loading() && this.searchedQuery() === query ? query : null;
    });
  }
}
