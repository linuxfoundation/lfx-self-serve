// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import {
  createUnavailableFormationPeopleResponse,
  FORMATION_INVITE_DIALOG_HEADER,
  FORMATION_PEOPLE_EMPTY_MESSAGE,
  FORMATION_PEOPLE_FOOTER_NOTE,
  FORMATION_PEOPLE_GROUP_LABELS,
  FORMATION_PEOPLE_HEADING,
  FORMATION_PEOPLE_UNAVAILABLE_MESSAGE,
  FORMATION_PERSON_STATUS_LABELS,
} from '@lfx-one/shared/constants';
import type {
  FormationChecklistResponse,
  FormationInviteDialogData,
  FormationInviteOutcome,
  FormationPeopleResponse,
  FormationPeopleRowGroup,
} from '@lfx-one/shared/interfaces';
import { formationPeopleGroupKeys, groupFormationPeople, toFormationPersonRow } from '@lfx-one/shared/utils';
import { FormationService } from '@services/formation.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { distinctUntilChanged, map, merge, Subject, switchMap, take, tap } from 'rxjs';

import { FormationInviteDialogComponent } from '../formation-invite-dialog/formation-invite-dialog.component';

/**
 * "People on this formation" — the checklist sidebar's people card (#2724), rendered under
 * `lfx-formation-card` on both checklist hosts. Lists the project's settings roles (a formation
 * invite is a project invite, #2147) grouped into LF Staff and Invited, each external row carrying
 * an "Invited" (has an LF account) or "Invite Sent" (email-only, pending acceptance) chip.
 *
 * Writers (`can_write` on the response) also get an **Invite** action (PR 2) that opens
 * `FormationInviteDialogComponent` through `DialogService` — the module's dialog convention
 * (`staff-edit-dialog`, `reason-prompt-dialog`); the dialog owns the add flow and closes with its
 * outcome, and this card re-reads its list. The action waits for the list to load: the dialog's
 * duplicate guard needs the addresses already listed, and while the settings read is refused for
 * this caller (`unavailable`) the add would only fail the same way.
 *
 * Fed from the checklist response the host already holds: the slug, the writer flag and each row's
 * assigned-item count come off it, so the card never reads `ProjectContextService` — on the
 * foundation drill-down that service describes the *parent foundation*, and a context-derived slug
 * would list the foundation's people beside a child project's checklist (#2719 precedent). The
 * list itself is one extra read, `GET /api/projects/:slug/formation/people`, which the BFF degrades
 * to an `unavailable` state when upstream refuses the settings read behind it; that renders as its
 * own quiet block rather than an error, since the checklist beside it loaded fine.
 */
@Component({
  selector: 'lfx-formation-people-card',
  imports: [PersonAvatarComponent, SkeletonModule],
  providers: [DialogService],
  templateUrl: './formation-people-card.component.html',
  styleUrl: './formation-people-card.component.scss',
})
export class FormationPeopleCardComponent {
  private readonly formationService = inject(FormationService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly checklist = input.required<FormationChecklistResponse>();

  protected readonly heading = FORMATION_PEOPLE_HEADING;
  protected readonly footerNote = FORMATION_PEOPLE_FOOTER_NOTE;
  protected readonly emptyMessage = FORMATION_PEOPLE_EMPTY_MESSAGE;
  protected readonly unavailableMessage = FORMATION_PEOPLE_UNAVAILABLE_MESSAGE;
  protected readonly statusLabels = FORMATION_PERSON_STATUS_LABELS;

  protected readonly loading = signal(true);
  // Re-fetch trigger after a successful invite. A Subject, not a BehaviorSubject, so nothing emits
  // at subscription time while the required `checklist` input is still unreadable (NG0950).
  private readonly refresh$ = new Subject<void>();

  protected readonly projectSlug = computed(() => this.checklist().formation.parent_project_slug);
  protected readonly projectUid = computed(() => this.checklist().formation.parent_project_uid);
  protected readonly canWrite = computed(() => this.checklist().can_write);
  /** The checklist items' owners, for each row's assigned-item count — from the read the host already made, never a second one. */
  private readonly assignees = computed(() => this.checklist().items.map((item) => item.owner?.username ?? null));
  protected readonly response: Signal<FormationPeopleResponse> = this.initResponse();
  protected readonly unavailable = computed(() => this.response().state === 'unavailable');
  protected readonly groups: Signal<FormationPeopleRowGroup[]> = this.initGroups();
  protected readonly isEmpty = computed(() => this.groups().length === 0);
  /** Lowercased addresses already listed — handed to the dialog, which rejects them inline with no request. */
  protected readonly existingEmails = computed(() =>
    this.response()
      .people.map((person) => person.email.trim().toLowerCase())
      // A settings entry can carry a username and no email; an empty string must never reach the guard.
      .filter((email) => email.length > 0)
  );
  /**
   * Invite is offered only while a loaded, current list is on screen. Before the first read lands
   * `existingEmails` would be empty, and during a re-read after an invite it would still be the
   * previous list — either way a re-add of someone already on the project as View would silently
   * demote them, so `loading` gates it as well as `unavailable`. While the settings read is
   * refused, the add's own settings read fails the same way, so the button would only offer an
   * action that ends in the error toast.
   */
  protected readonly canInvite = computed(() => this.canWrite() && !this.unavailable() && !this.loading());

  protected openInvite(): void {
    if (!this.canInvite()) {
      return;
    }

    const data: FormationInviteDialogData = { projectUid: this.projectUid(), existingEmails: this.existingEmails() };

    const ref: DynamicDialogRef | null = this.dialogService.open(FormationInviteDialogComponent, {
      header: FORMATION_INVITE_DIALOG_HEADER,
      width: '500px',
      // Cap on narrow viewports (the Aura preset sets no maximum), like the other dynamic dialogs.
      style: { maxWidth: '90vw' },
      modal: true,
      // Explicit-only dismissal (the staff dialog's rationale): a mask/Esc/X close mid-submit
      // would emit a falsey result and skip the refresh while the in-flight add still lands.
      closable: false,
      dismissableMask: false,
      closeOnEscape: false,
      data,
    });

    // takeUntilDestroyed: the dialog outlives this host when the card is destroyed with the
    // dialog still open — without it, a later close would refresh a torn-down card.
    ref?.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((outcome: FormationInviteOutcome | undefined) => {
      if (outcome) {
        this.refresh$.next();
      }
    });
  }

  private initResponse(): Signal<FormationPeopleResponse> {
    return toSignal(
      merge(toObservable(this.projectSlug).pipe(distinctUntilChanged()), this.refresh$.pipe(map(() => this.projectSlug()))).pipe(
        tap(() => this.loading.set(true)),
        // `getFormationPeople` never errors (it degrades to the unavailable shape itself), so
        // clearing `loading` on next is complete. Deliberately not `finalize` on the inner: a
        // switchMap cancel would run it AFTER the new emission's `tap` above and blank the spinner
        // for the request that just started.
        switchMap((slug) => this.formationService.getFormationPeople(slug).pipe(tap(() => this.loading.set(false))))
      ),
      { initialValue: createUnavailableFormationPeopleResponse() }
    );
  }

  private initGroups(): Signal<FormationPeopleRowGroup[]> {
    return computed(() => {
      const grouped = groupFormationPeople(this.response().people);
      const assignees = this.assignees();

      // Render order is the labels constant's declaration order (staff first) — derived, not
      // restated, so a group added to the constant renders without a matching edit here.
      return formationPeopleGroupKeys()
        .map((key) => ({ key, label: FORMATION_PEOPLE_GROUP_LABELS[key], rows: grouped[key].map((person) => toFormationPersonRow(person, assignees)) }))
        .filter((group) => group.rows.length > 0);
    });
  }
}
