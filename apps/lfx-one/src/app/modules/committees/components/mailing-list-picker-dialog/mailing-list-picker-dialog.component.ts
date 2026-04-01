// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { GroupsIOMailingList, MailingListPickerDialogResult } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { MailingListEmailPipe } from '../committee-settings-tab/pipes/mailing-list-email.pipe';
import { MailingListTypePipe } from '../committee-settings-tab/pipes/mailing-list-type.pipe';

@Component({
  selector: 'lfx-mailing-list-picker-dialog',
  imports: [ButtonComponent, CheckboxComponent, InputTextComponent, ReactiveFormsModule, RouterLink, TagComponent, MailingListEmailPipe, MailingListTypePipe],
  templateUrl: './mailing-list-picker-dialog.component.html',
})
export class MailingListPickerDialogComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly destroyRef = inject(DestroyRef);

  public readonly mailingLists: GroupsIOMailingList[] = this.config.data.mailingLists;
  public readonly projectUid: string = this.config.data.projectUid;

  public selectedMailingListUids = signal<Set<string>>(new Set(this.config.data.associatedUids));
  public mlSearchQuery = signal('');

  public mlSearchForm = new FormGroup({
    query: new FormControl(''),
  });

  public mlCheckboxForm = new FormGroup<Record<string, FormControl<boolean>>>({});

  public filteredMailingLists = computed(() => {
    const query = this.mlSearchQuery().toLowerCase().trim();
    const lists = this.mailingLists.filter((ml) => !!ml.service?.domain);
    if (!query) return lists;
    return lists.filter((ml) => ml.group_name.toLowerCase().includes(query) || ml.title?.toLowerCase().includes(query));
  });

  public selectedCount = computed(() => this.selectedMailingListUids().size);

  public constructor() {
    // Build checkbox form controls
    const associatedUids = this.config.data.associatedUids as Set<string>;
    const controls: Record<string, FormControl<boolean>> = {};
    for (const ml of this.mailingLists) {
      controls[ml.uid] = new FormControl(associatedUids.has(ml.uid), { nonNullable: true });
    }
    this.mlCheckboxForm = new FormGroup(controls);

    this.mlSearchForm
      .get('query')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => {
        this.mlSearchQuery.set(val ?? '');
      });
  }

  public toggleMailingList(uid: string): void {
    const current = new Set(this.selectedMailingListUids());
    if (current.has(uid)) {
      current.delete(uid);
    } else {
      current.add(uid);
    }
    this.selectedMailingListUids.set(current);
    this.mlCheckboxForm.get(uid)?.setValue(current.has(uid));
  }

  public save(): void {
    this.dialogRef.close({ selectedUids: this.selectedMailingListUids() } as MailingListPickerDialogResult);
  }

  public cancel(): void {
    this.dialogRef.close(null);
  }
}
