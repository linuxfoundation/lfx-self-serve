// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { filter } from 'rxjs';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import { CROWDFUNDING_DESCRIPTION_MAX_CHARS, CROWDFUNDING_DESCRIPTION_MAX_HTML_CHARS, CROWDFUNDING_TOPIC_OPTIONS } from '@lfx-one/shared/constants';
import { InitiativeDetail } from '@lfx-one/shared/interfaces';
import { codePointLength, plainTextToHtml, stripHtml } from '@lfx-one/shared/utils';
import { htmlMaxLengthValidator, htmlRequiredValidator, maxCodePointsValidator } from '@lfx-one/shared/validators';

@Component({
  selector: 'lfx-settings-details-tab',
  imports: [ReactiveFormsModule, InputTextComponent, RichEditorComponent, MultiSelectComponent],
  templateUrl: './settings-details-tab.component.html',
})
export class SettingsDetailsTabComponent {
  public readonly visible = input.required<boolean>();
  public readonly initiative = input.required<InitiativeDetail>();

  protected readonly topicOptions = CROWDFUNDING_TOPIC_OPTIONS;
  protected readonly descriptionMaxChars = CROWDFUNDING_DESCRIPTION_MAX_CHARS;

  public readonly form: FormGroup = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(100)]),
    // The editor stores HTML: required and the length cap apply to the visible text, while the raw
    // markup is held to the upstream service's own cap so heavy formatting fails here, not on save.
    description: new FormControl('', [
      htmlRequiredValidator(),
      htmlMaxLengthValidator(CROWDFUNDING_DESCRIPTION_MAX_CHARS),
      maxCodePointsValidator(CROWDFUNDING_DESCRIPTION_MAX_HTML_CHARS),
    ]),
    topics: new FormControl<string[]>([], { nonNullable: true }),
    websiteUrl: new FormControl(''),
  });

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  protected readonly nameLength = computed(() => this.formValue().name?.length ?? 0);
  protected readonly descriptionLength = computed(() => stripHtml(this.formValue().description).length);
  protected readonly descriptionTooLong = computed(() => this.descriptionLength() > CROWDFUNDING_DESCRIPTION_MAX_CHARS);
  // Only reported while the visible text fits, so the reader sees one error at a time.
  protected readonly descriptionMarkupTooLong = computed(
    () => !this.descriptionTooLong() && codePointLength(this.formValue().description ?? '') > CROWDFUNDING_DESCRIPTION_MAX_HTML_CHARS
  );

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
          // Older descriptions are plain text; converting keeps their line breaks in the editor.
          description: plainTextToHtml(init.description),
          topics: existingTopics,
          websiteUrl: init.websiteUrl ?? '',
        });
      });
  }
}
