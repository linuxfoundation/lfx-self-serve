// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { GroupsIOMailingList, MailingListPickerDialogResult } from '@lfx-one/shared/interfaces';
import { MAILING_LIST_ACCESS_DENIED_MESSAGE } from '@lfx-one/shared/constants';
import { getMailingListEmail } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { PersonaService } from '@services/persona.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { finalize, map, Observable, of, switchMap, take } from 'rxjs';

import { MailingListEmailPipe } from '../../pipes/mailing-list-email.pipe';
import { MailingListTypePipe } from '../committee-settings-tab/pipes/mailing-list-type.pipe';

@Component({
  selector: 'lfx-mailing-list-picker-dialog',
  imports: [
    ButtonComponent,
    CheckboxComponent,
    InputTextComponent,
    ReactiveFormsModule,
    TagComponent,
    TooltipModule,
    MailingListEmailPipe,
    MailingListTypePipe,
  ],
  templateUrl: './mailing-list-picker-dialog.component.html',
})
export class MailingListPickerDialogComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly committeeService = inject(CommitteeService);
  private readonly messageService = inject(MessageService);
  private readonly personaService = inject(PersonaService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);

  public readonly mailingLists: GroupsIOMailingList[] = this.config.data.mailingLists;
  private readonly committeeUid: string = this.config.data.committeeUid;
  private readonly projectSlug: string | undefined = this.config.data.projectSlug;

  public selectedMailingListUids = signal<Set<string>>(new Set(this.config.data.associatedUids));
  public mlSearchQuery = signal('');
  public creating = signal(false);

  public mlSearchForm = new FormGroup({
    query: new FormControl(''),
  });

  public mlCheckboxForm = new FormGroup<Record<string, FormControl<boolean>>>({});

  public filteredMailingLists = computed(() => {
    const query = this.mlSearchQuery().toLowerCase().trim();
    const lists = this.mailingLists.filter((ml) => !!getMailingListEmail(ml));
    if (!query) return lists;
    return lists.filter((ml) => ml.group_name.toLowerCase().includes(query) || ml.title?.toLowerCase().includes(query));
  });

  public selectedCount = computed(() => this.selectedMailingListUids().size);

  public constructor() {
    // Build checkbox form controls
    const associatedUids = this.config.data.associatedUids as Set<string>;
    const controls: Record<string, FormControl<boolean>> = {};
    for (const ml of this.mailingLists) {
      controls[ml.uid] = new FormControl({ value: associatedUids.has(ml.uid), disabled: !this.canModify(ml) }, { nonNullable: true });
    }
    this.mlCheckboxForm = new FormGroup(controls);

    this.mlSearchForm
      .get('query')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((val) => {
        this.mlSearchQuery.set(val ?? '');
      });
  }

  /** Linking or unlinking a list updates the list itself, so the user needs write access to it. */
  public canModify(ml: GroupsIOMailingList): boolean {
    return ml.writer === true;
  }

  public toggleMailingList(uid: string): void {
    const ml = this.mailingLists.find((m) => m.uid === uid);
    if (!ml || !this.canModify(ml)) return;

    const current = new Set(this.selectedMailingListUids());
    if (current.has(uid)) {
      current.delete(uid);
    } else {
      current.add(uid);
    }
    this.selectedMailingListUids.set(current);
    this.mlCheckboxForm.get(uid)?.setValue(current.has(uid));
  }

  public onCreateNewList(): void {
    this.creating.set(true);
    this.committeeService
      .getCommittee(this.committeeUid)
      .pipe(
        take(1),
        // Creating a list is a project-level action (the create route is guarded on project write access),
        // so being able to write this group is not enough — check the project too before leaving the page.
        switchMap((fresh) => (fresh?.writer === true ? this.hasProjectWriteAccess() : of(false))),
        finalize(() => this.creating.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (allowed) => {
          if (!allowed) {
            // Stay on the page the user is on rather than redirecting them away from it.
            this.messageService.add({ severity: 'warn', summary: 'Access Denied', detail: MAILING_LIST_ACCESS_DENIED_MESSAGE });
            return;
          }
          const createParams: Record<string, string> = {};
          if (this.projectSlug) createParams['project'] = this.projectSlug;
          this.cancel();
          void this.router.navigate(['/mailing-lists', 'create'], { queryParams: createParams });
        },
        error: () => this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Unable to verify your access. Please try again.' }),
      });
  }

  public save(): void {
    this.dialogRef.close({ selectedUids: this.selectedMailingListUids() } as MailingListPickerDialogResult);
  }

  public cancel(): void {
    this.dialogRef.close(null);
  }

  // Mirrors writerGuard for the create route: executive directors pass, otherwise the project's `writer` flag decides.
  // With no project slug there is nothing to check here, so navigation proceeds and the guard decides.
  private hasProjectWriteAccess(): Observable<boolean> {
    if (this.personaService.currentPersona() === 'executive-director' || !this.projectSlug) {
      return of(true);
    }
    return this.projectService.getProjectStrict(this.projectSlug).pipe(
      take(1),
      map((project) => project.writer === true)
    );
  }
}
