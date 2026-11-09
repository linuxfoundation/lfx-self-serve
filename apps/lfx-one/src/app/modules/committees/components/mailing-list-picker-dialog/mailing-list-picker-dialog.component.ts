// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, effect, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { SelectComponent } from '@components/select/select.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  COMMITTEE_LABEL,
  MAILING_LIST_ACCESS_DENIED_MESSAGE,
  MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG,
  MEMBER_FORM_VOTING_STATUSES,
  MEMBER_ROLES,
} from '@lfx-one/shared/constants';
import { CommitteeMemberRole, CommitteeMemberVotingStatus, MailingListSyncMode } from '@lfx-one/shared/enums';
import { GroupsIOMailingList, MailingListPickerDialogResult } from '@lfx-one/shared/interfaces';
import { getMailingListEmail } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { finalize, map, Observable, of, switchMap, take } from 'rxjs';

import { MailingListDirectionDisabledReasonPipe } from '../../pipes/mailing-list-direction-disabled-reason.pipe';
import { MailingListEmailPipe } from '../../pipes/mailing-list-email.pipe';
import { MailingListTypePipe } from '../committee-settings-tab/pipes/mailing-list-type.pipe';

@Component({
  selector: 'lfx-mailing-list-picker-dialog',
  imports: [
    ButtonComponent,
    CheckboxComponent,
    InputTextComponent,
    MultiSelectComponent,
    SelectComponent,
    ReactiveFormsModule,
    TagComponent,
    TooltipModule,
    MailingListDirectionDisabledReasonPipe,
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
  private readonly featureFlagService = inject(FeatureFlagService);
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

  // Dark-launch gate for the per-list sync direction column (#4026) — same flag that guards the
  // Mailing List Sync Settings section (#4024), since both surface the same `sync_mode` write path.
  protected readonly syncEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG, false);
  protected readonly committeeLabel = COMMITTEE_LABEL;
  protected readonly directionOptions = [
    { label: 'Manual', value: MailingListSyncMode.MANUAL },
    { label: `${COMMITTEE_LABEL.singular} → Mailing List`, value: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST },
    { label: `Mailing List → ${COMMITTEE_LABEL.singular}`, value: MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE },
  ];
  protected readonly autoCToMlMode = MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST;
  // Criterion 3 (#4026) filter options, sourced from the committee domain's existing taxonomies
  // rather than a guessed/hardcoded list — same constants the member form's voting-status and role
  // pickers use. "None" is excluded from both: it's not a meaningful sync filter.
  protected readonly committeeFilterOptions = MEMBER_FORM_VOTING_STATUSES;
  protected readonly committeeRoleFilterOptions = MEMBER_ROLES.filter((role) => role.value !== CommitteeMemberRole.NONE);

  // One direction control per candidate list (not just currently-linked ones), so a direction
  // picked before a list is linked (or re-picked after unlinking and relinking within the same
  // dialog session) survives the round trip. Built once in the constructor since `mailingLists`
  // itself never changes for the lifetime of the dialog.
  public mlDirectionForm = new FormGroup<Record<string, FormControl<MailingListSyncMode>>>({});
  // Criterion 3 (#4026): per-list committee-filter controls, only meaningful (and only rendered)
  // while that list's direction control holds auto_c_to_ml — built alongside mlDirectionForm for
  // the same reason (one control per candidate list, not just currently-linked ones).
  public mlCommitteeFilterForm = new FormGroup<Record<string, FormControl<CommitteeMemberVotingStatus[]>>>({});
  public mlCommitteeRoleFilterForm = new FormGroup<Record<string, FormControl<string[]>>>({});
  // Mirrors mlDirectionForm's value, including disabled controls (`getRawValue()`), so
  // activeAutoSyncUid can see a direction set on a list the user can't currently write (#4026).
  public syncDirections = signal<Record<string, MailingListSyncMode>>({});

  // Only one mailing list per committee may have an automatic direction configured at a time
  // (matches MailingListSyncSettingsComponent's "only one auto direction per committee" rule) —
  // resolves which *selected* list, if any, currently holds that slot, so every other row's
  // direction control gets disabled until it's freed up.
  public activeAutoSyncUid = computed<string | null>(() => {
    const dirs = this.syncDirections();
    const selected = this.selectedMailingListUids();
    for (const ml of this.mailingLists) {
      const direction = dirs[ml.uid];
      if (selected.has(ml.uid) && direction && direction !== MailingListSyncMode.MANUAL) {
        return ml.uid;
      }
    }
    return null;
  });

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

    // Build sync-direction form controls, seeded from each list's persisted `sync_mode` — but only
    // for lists already linked to THIS committee. A list linked elsewhere (or never linked) seeds
    // Manual, otherwise its inherited direction would be sent as an explicit choice the admin never
    // made, bypassing the reset-to-Manual that applies when moving a list between committees.
    const directionControls: Record<string, FormControl<MailingListSyncMode>> = {};
    for (const ml of this.mailingLists) {
      const initial = associatedUids.has(ml.uid) && ml.sync_mode && ml.sync_mode !== MailingListSyncMode.MANUAL ? ml.sync_mode : MailingListSyncMode.MANUAL;
      directionControls[ml.uid] = new FormControl(initial, { nonNullable: true });
    }
    this.mlDirectionForm = new FormGroup(directionControls);
    this.syncDirections.set(this.mlDirectionForm.getRawValue());
    this.mlDirectionForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.syncDirections.set(this.mlDirectionForm.getRawValue());
    });

    // Build committee-filter controls (#4026 criterion 3), seeded the same way as the direction
    // controls above: only a list already linked to THIS committee AND already in auto_c_to_ml mode
    // carries its persisted filters forward, otherwise it starts with no restriction. These controls
    // are only ever meaningful (and only ever rendered) while the paired direction control holds
    // auto_c_to_ml, so there's no separate "linked to a different committee" branch to worry about.
    const committeeFilterControls: Record<string, FormControl<CommitteeMemberVotingStatus[]>> = {};
    const committeeRoleFilterControls: Record<string, FormControl<string[]>> = {};
    for (const ml of this.mailingLists) {
      const seedsFilters = associatedUids.has(ml.uid) && ml.sync_mode === MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST;
      committeeFilterControls[ml.uid] = new FormControl(seedsFilters ? (ml.committee_filters ?? []) : [], { nonNullable: true });
      committeeRoleFilterControls[ml.uid] = new FormControl(seedsFilters ? (ml.committee_role_filters ?? []) : [], { nonNullable: true });
    }
    this.mlCommitteeFilterForm = new FormGroup(committeeFilterControls);
    this.mlCommitteeRoleFilterForm = new FormGroup(committeeRoleFilterControls);

    // Keep each direction control's enabled state in sync with write access, link state, and the
    // "only one auto direction per committee" rule. Uses emitEvent: false so this never feeds back
    // into the valueChanges subscription above. The paired committee-filter controls (#4026
    // criterion 3) follow the same enabled state, further gated on the row actually being in
    // auto_c_to_ml mode — they're invisible otherwise, but disabling keeps getRawValue() consistent.
    effect(() => {
      const activeUid = this.activeAutoSyncUid();
      const selected = this.selectedMailingListUids();
      const directions = this.syncDirections();
      for (const ml of this.mailingLists) {
        const control = this.mlDirectionForm.get(ml.uid);
        const filterControl = this.mlCommitteeFilterForm.get(ml.uid);
        const roleFilterControl = this.mlCommitteeRoleFilterForm.get(ml.uid);
        if (!control) continue;
        const shouldDisable = !this.canModify(ml) || !selected.has(ml.uid) || (activeUid !== null && activeUid !== ml.uid);
        if (shouldDisable && control.enabled) {
          control.disable({ emitEvent: false });
        } else if (!shouldDisable && control.disabled) {
          control.enable({ emitEvent: false });
        }

        const shouldDisableFilters = shouldDisable || directions[ml.uid] !== MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST;
        for (const fc of [filterControl, roleFilterControl]) {
          if (!fc) continue;
          if (shouldDisableFilters && fc.enabled) {
            fc.disable({ emitEvent: false });
          } else if (!shouldDisableFilters && fc.disabled) {
            fc.enable({ emitEvent: false });
          }
        }
      }
    });

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
      // Unlinking clears any direction chosen in this dialog session — it no longer applies once
      // the list is detached from the committee, and leaving it set would wrongly occupy the
      // "only one auto direction" slot if the list were re-linked later in the same session. Any
      // committee filters chosen alongside that direction (#4026 criterion 3) are cleared with it.
      this.mlDirectionForm.get(uid)?.setValue(MailingListSyncMode.MANUAL);
      this.mlCommitteeFilterForm.get(uid)?.setValue([]);
      this.mlCommitteeRoleFilterForm.get(uid)?.setValue([]);
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
    // Dark-launched behind syncEnabled() (#4026) — an empty map tells the caller to fall back to
    // preserving each list's existing sync_mode (and, for criterion 3, its existing filters) rather
    // than resetting everything to manual/unfiltered.
    const syncModes = this.syncEnabled() ? new Map(Object.entries(this.mlDirectionForm.getRawValue())) : new Map<string, MailingListSyncMode>();
    const committeeFilters = this.syncEnabled()
      ? new Map(Object.entries(this.mlCommitteeFilterForm.getRawValue()))
      : new Map<string, CommitteeMemberVotingStatus[]>();
    const committeeRoleFilters = this.syncEnabled() ? new Map(Object.entries(this.mlCommitteeRoleFilterForm.getRawValue())) : new Map<string, string[]>();
    this.dialogRef.close({
      selectedUids: this.selectedMailingListUids(),
      syncModes,
      committeeFilters,
      committeeRoleFilters,
    } as MailingListPickerDialogResult);
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
