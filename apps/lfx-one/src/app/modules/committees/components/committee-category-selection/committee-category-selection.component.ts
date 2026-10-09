// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardSelectorComponent } from '@components/card-selector/card-selector.component';
import { MessageComponent } from '@components/message/message.component';
import { COMMITTEE_CATEGORY_CONFIGS, COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { CardSelectorOption } from '@lfx-one/shared/interfaces';
import { getSelectableCommitteeCategories } from '@lfx-one/shared/utils';
import { PersonaService } from '@services/persona.service';

@Component({
  selector: 'lfx-committee-category-selection',
  imports: [ReactiveFormsModule, CardSelectorComponent, MessageComponent],
  templateUrl: './committee-category-selection.component.html',
})
export class CommitteeCategorySelectionComponent {
  private readonly personaService = inject(PersonaService);

  // Signal inputs
  public form = input.required<FormGroup>();

  // UI labels
  public readonly committeeLabel = COMMITTEE_LABEL.singular;

  // Category options for card selector (computed based on persona)
  public readonly categoryOptions = computed<CardSelectorOption<string>[]>(() =>
    getSelectableCommitteeCategories(this.personaService.currentPersona()).map((category) => ({
      label: category.label,
      value: category.value,
      info: COMMITTEE_CATEGORY_CONFIGS[category.value],
    }))
  );
}
