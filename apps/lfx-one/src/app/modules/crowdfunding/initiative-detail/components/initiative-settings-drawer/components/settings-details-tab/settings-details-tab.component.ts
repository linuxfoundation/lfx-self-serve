// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { filter } from 'rxjs';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { CROWDFUNDING_TOPIC_OPTIONS } from '@lfx-one/shared/constants';
import { InitiativeDetail } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-settings-details-tab',
  imports: [ReactiveFormsModule, InputTextComponent, TextareaComponent, MultiSelectComponent],
  templateUrl: './settings-details-tab.component.html',
})
export class SettingsDetailsTabComponent {
  public readonly visible = input.required<boolean>();
  public readonly initiative = input.required<InitiativeDetail>();

  protected readonly topicOptions = CROWDFUNDING_TOPIC_OPTIONS;

  public readonly form: FormGroup = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    description: new FormControl('', [Validators.required, Validators.maxLength(500)]),
    topics: new FormControl<string[]>([], { nonNullable: true }),
    websiteUrl: new FormControl(''),
  });

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected readonly nameLength = computed(() => this.formValue().name?.length ?? 0);
  protected readonly descriptionLength = computed(() => this.formValue().description?.length ?? 0);

  public constructor() {
    toObservable(this.visible)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe(() => {
        const init = this.initiative();
        const existingTopics = init.industry
          ? init.industry
              .split(',')
              .map((v) => v.trim())
              .filter((v) => v && v.toLowerCase() !== 'null') // CF API bug: null tags serialised as the string "null"
          : [];
        this.form.reset({
          name: init.name,
          description: init.description,
          topics: existingTopics,
          websiteUrl: init.websiteUrl ?? '',
        });
      });
  }
}
