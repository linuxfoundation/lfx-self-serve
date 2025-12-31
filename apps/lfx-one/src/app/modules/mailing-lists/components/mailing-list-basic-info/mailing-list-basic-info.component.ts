// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { GroupsIOService } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-mailing-list-basic-info',
  imports: [ReactiveFormsModule, InputTextComponent, TextareaComponent],
  templateUrl: './mailing-list-basic-info.component.html',
})
export class MailingListBasicInfoComponent {
  public readonly form = input.required<FormGroup>();
  public readonly formValue = input.required<Signal<Record<string, unknown>>>();
  public readonly service = input<GroupsIOService | null>(null);
  public readonly prefix = input<string>('');
  public readonly maxGroupNameLength = input<number>(34);

  public readonly projectName = computed(() => {
    return this.service()?.project_name || 'Your Project';
  });

  public readonly serviceDomain = computed(() => {
    return this.service()?.domain || 'groups.io';
  });

  public readonly emailPreview = computed(() => {
    const groupName = (this.formValue()()?.['group_name'] as string) || 'listname';
    const prefixValue = this.prefix();
    const domain = this.serviceDomain();
    return `${prefixValue}${groupName}@${domain}`;
  });

  public readonly groupNameTooLong = computed(() => {
    const groupName = (this.formValue()()?.['group_name'] as string) || '';
    const maxLength = this.maxGroupNameLength();
    return groupName.length > maxLength;
  });

  public readonly groupNameLengthError = computed(() => {
    const maxLength = this.maxGroupNameLength();
    const prefixValue = this.prefix();
    if (prefixValue) {
      return `Name cannot exceed ${maxLength} characters (prefix "${prefixValue}" uses ${prefixValue.length} of 34 allowed)`;
    }
    return `Name cannot exceed ${maxLength} characters`;
  });
}
