// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ProjectContextService } from '@app/shared/services/project-context.service';
import { EditorComponent } from '@components/editor/editor.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { GroupsIOService } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-mailing-list-basic-info',
  imports: [ReactiveFormsModule, InputTextComponent, EditorComponent],
  templateUrl: './mailing-list-basic-info.component.html',
})
export class MailingListBasicInfoComponent {
  private readonly projectContextService = inject(ProjectContextService);

  public readonly form = input.required<FormGroup>();
  public readonly formValue = input.required<Signal<Record<string, unknown>>>();
  public readonly service = input<GroupsIOService | null>(null);
  public readonly prefix = input<string>('');
  public readonly maxGroupNameLength = input<number>(34);
  public readonly isEditMode = input<boolean>(false);

  public readonly projectName = computed(() => {
    return this.service()?.project_name || this.projectContextService.selectedProject()?.name || this.projectContextService.selectedFoundation()?.name || '';
  });

  public readonly serviceDomain = computed(() => {
    return this.service()?.domain || 'groups.io';
  });

  public readonly isSharedService = computed(() => {
    const service = this.service();
    if (!service) return false;

    const currentProjectUid = this.projectContextService.selectedProject()?.uid || this.projectContextService.selectedFoundation()?.uid;

    // If service type is explicitly 'shared', it's a shared service
    if (service.type === 'shared') return true;

    // If current project UID doesn't match service project UID, and service is primary, it's being used as shared
    if (currentProjectUid !== service.project_uid && service.type === 'primary') return true;

    return false;
  });

  public readonly emailPreview = computed(() => {
    const groupName = (this.formValue()()?.['group_name'] as string) || 'listname';
    const prefixValue = this.prefix();
    const domain = this.serviceDomain();

    // For shared services, include prefix with hyphen
    if (this.isSharedService()) {
      return `${prefixValue}-${groupName}@${domain}`;
    }

    // For non-shared services, no prefix
    return `${groupName}@${domain}`;
  });

  public readonly groupNameTooLong = computed(() => {
    const groupName = (this.formValue()()?.['group_name'] as string) || '';
    const maxLength = this.maxGroupNameLength();
    return groupName.length > maxLength;
  });

  public readonly groupNameLengthError = computed(() => {
    const maxLength = this.maxGroupNameLength();
    const prefixValue = this.prefix() + '-';

    // For shared services, include hyphen in the count
    if (this.isSharedService() && prefixValue) {
      const prefixWithHyphenLength = prefixValue.length;
      return `Name cannot exceed ${maxLength} characters (prefix "${prefixValue}" uses ${prefixWithHyphenLength} of 34 allowed)`;
    }

    // For non-shared services, no prefix consideration
    return `Name cannot exceed ${maxLength} characters`;
  });
}
