// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, model, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import {
  createUnavailableFormationPeopleResponse,
  ERROR_CODES,
  FORMATION_INVITE_ROLE_OPTIONS,
  FORMATION_PEOPLE_EMPTY_MESSAGE,
  FORMATION_PEOPLE_FOOTER_NOTE,
  FORMATION_PEOPLE_GROUP_LABELS,
  FORMATION_PEOPLE_HEADING,
  FORMATION_PEOPLE_UNAVAILABLE_MESSAGE,
  FORMATION_PERSON_STATUS_LABELS,
} from '@lfx-one/shared/constants';
import type {
  FormationChecklistResponse,
  FormationInviteFormValue,
  FormationInviteOutcome,
  FormationPeopleResponse,
  FormationPeopleRowGroup,
} from '@lfx-one/shared/interfaces';
import { formationPeopleGroupKeys, groupFormationPeople, toFormationPersonRow } from '@lfx-one/shared/utils';
import { FormationService } from '@services/formation.service';
import { PermissionsService } from '@services/permissions.service';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { MessageService } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, map, merge, Subject, switchMap, take, tap, throwError } from 'rxjs';

import { FormationInviteDialogComponent } from '../formation-invite-dialog/formation-invite-dialog.component';

/**
 * "People on this formation" — the checklist sidebar's people card (#2724), rendered under
 * `lfx-formation-card` on both checklist hosts. Lists the project's settings roles (a formation
 * invite is a project invite, #2147) grouped into LF Staff and Invited, each external row carrying
 * an "Invited" (has an LF account) or "Invite Sent" (email-only, pending acceptance) chip.
 *
 * Writers (`can_write` on the response) also get an **Invite** action (PR 2 of #2724). A
 * formation invite is a project invite: the dialog's submission goes to the project permissions
 * add flow, directory lookup first — an address with an LF account is added outright — and, on a
 * `NOT_FOUND` miss, again with the name, which stores an email-only entry and is what makes
 * upstream send the invite email; the row then shows "Invite Sent" until they accept.
 *
 * Fed from the checklist response the host already holds: the slug, the writer flag and each row's
 * assigned-item count come off it, so the card never reads `ProjectContextService` — on the foundation drill-down that service
 * describes the *parent foundation*, and a context-derived slug would list the foundation's people
 * beside a child project's checklist (#2719 precedent). The list itself is one extra read,
 * `GET /api/projects/:slug/formation/people`, which the BFF degrades to an `unavailable` state when
 * upstream refuses the settings read behind it; that renders as its own quiet block rather than an
 * error, since the checklist beside it loaded fine.
 */
@Component({
  selector: 'lfx-formation-people-card',
  imports: [PersonAvatarComponent, SkeletonModule, FormationInviteDialogComponent],
  templateUrl: './formation-people-card.component.html',
  styleUrl: './formation-people-card.component.scss',
})
export class FormationPeopleCardComponent {
  private readonly formationService = inject(FormationService);
  private readonly permissionsService = inject(PermissionsService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly checklist = input.required<FormationChecklistResponse>();

  public readonly inviteVisible = model(false);

  protected readonly heading = FORMATION_PEOPLE_HEADING;
  protected readonly footerNote = FORMATION_PEOPLE_FOOTER_NOTE;
  protected readonly emptyMessage = FORMATION_PEOPLE_EMPTY_MESSAGE;
  protected readonly unavailableMessage = FORMATION_PEOPLE_UNAVAILABLE_MESSAGE;
  protected readonly statusLabels = FORMATION_PERSON_STATUS_LABELS;

  protected readonly loading = signal(true);
  protected readonly inviting = signal(false);
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
  /** Lowercased addresses already listed — the dialog rejects these inline, with no request. */
  protected readonly existingEmails = computed(() => this.response().people.map((person) => person.email.trim().toLowerCase()));

  protected openInvite(): void {
    if (this.canWrite()) {
      this.inviteVisible.set(true);
    }
  }

  /**
   * Two-step add (mirrors the Permissions page and the staff dialog): the directory path first,
   * so an address with an LF account lands with a username and shows as "Invited" immediately;
   * on the BFF's `NOT_FOUND` directory miss, the same address again WITH the name, which the BFF
   * treats as a manual add and stores email-only — the shape upstream emails an invite for.
   */
  protected onInvite(value: FormationInviteFormValue): void {
    if (this.inviting()) {
      return;
    }

    const uid = this.projectUid();
    this.inviting.set(true);

    this.permissionsService
      .addUserToProject(uid, { email: value.email, role: value.role })
      .pipe(
        map((): FormationInviteOutcome => 'added'),
        catchError((error: unknown) => {
          if (!FormationPeopleCardComponent.isDirectoryMiss(error)) {
            return throwError(() => error);
          }
          return this.permissionsService
            .addUserToProject(uid, { name: value.name, email: value.email, role: value.role })
            .pipe(map((): FormationInviteOutcome => 'invite_sent'));
        }),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (outcome) => {
          this.inviting.set(false);
          this.inviteVisible.set(false);
          // The Permissions page shares the root-scoped settings cache; evict it so the new entry
          // shows there too, then re-read this card's own list.
          this.permissionsService.invalidateProjectSettings(uid);
          this.refresh$.next();
          this.messageService.add({
            severity: 'success',
            summary: outcome === 'invite_sent' ? 'Invite sent' : 'Added',
            detail: FormationPeopleCardComponent.successDetail(value, outcome),
            life: 3000,
          });
        },
        error: (error: unknown) => {
          this.inviting.set(false);
          this.messageService.add({
            severity: 'error',
            summary: 'Invite failed',
            detail: serverAuthoredMessage(error, 'Could not add this person. Please try again.'),
            life: 5000,
          });
        },
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

  /**
   * The BFF's directory miss on the add flow: a 404 whose body code is `NOT_FOUND`. Any other 404
   * (a project that vanished re-codes differently on the staff route but not here — see
   * `updateProjectPermissions`) also lands here and triggers the manual re-POST, which then 404s
   * again and surfaces as the error toast; acceptable degradation for a vanished project.
   */
  private static isDirectoryMiss(error: unknown): boolean {
    return error instanceof HttpErrorResponse && error.status === 404 && error.error?.code === ERROR_CODES.NOT_FOUND;
  }

  private static successDetail(value: FormationInviteFormValue, outcome: FormationInviteOutcome): string {
    const roleLabel = FORMATION_INVITE_ROLE_OPTIONS.find((option) => option.value === value.role)?.label ?? value.role;
    if (outcome === 'invite_sent') {
      return `An invite was emailed to ${value.email} for ${roleLabel} access.`;
    }
    return `${value.email} was added with ${roleLabel} access.`;
  }
}
