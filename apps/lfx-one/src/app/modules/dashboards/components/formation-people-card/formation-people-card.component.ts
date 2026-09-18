// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import {
  createUnavailableFormationPeopleResponse,
  FORMATION_PEOPLE_EMPTY_MESSAGE,
  FORMATION_PEOPLE_FOOTER_NOTE,
  FORMATION_PEOPLE_GROUP_LABELS,
  FORMATION_PEOPLE_HEADING,
  FORMATION_PEOPLE_UNAVAILABLE_MESSAGE,
  FORMATION_PERSON_STATUS_LABELS,
} from '@lfx-one/shared/constants';
import type { FormationChecklistResponse, FormationPeopleGroup, FormationPeopleResponse, FormationPeopleRowGroup } from '@lfx-one/shared/interfaces';
import { groupFormationPeople, toFormationPersonRow } from '@lfx-one/shared/utils';
import { FormationService } from '@services/formation.service';
import { SkeletonModule } from 'primeng/skeleton';
import { distinctUntilChanged, map, merge, Subject, switchMap, tap } from 'rxjs';

/**
 * "People on this formation" — the checklist sidebar's people card (#2724), rendered under
 * `lfx-formation-card` on both checklist hosts. Lists the project's settings roles (a formation
 * invite is a project invite, #2147) grouped into LF Staff and Invited, each external row carrying
 * an "Invited" (has an LF account) or "Invite Sent" (email-only, pending acceptance) chip.
 *
 * Fed entirely from the checklist response the host already holds: slug and writer flag come off
 * it, so the card never reads `ProjectContextService` — on the foundation drill-down that service
 * describes the *parent foundation*, and a context-derived slug would list the foundation's people
 * beside a child project's checklist (#2719 precedent). The list itself is one extra read,
 * `GET /api/projects/:slug/formation/people`, which the BFF degrades to an `unavailable` state when
 * upstream refuses the settings read behind it; that renders as its own quiet block rather than an
 * error, since the checklist beside it loaded fine.
 */
@Component({
  selector: 'lfx-formation-people-card',
  imports: [PersonAvatarComponent, SkeletonModule],
  templateUrl: './formation-people-card.component.html',
  styleUrl: './formation-people-card.component.scss',
})
export class FormationPeopleCardComponent {
  private readonly formationService = inject(FormationService);

  public readonly checklist = input.required<FormationChecklistResponse>();

  protected readonly heading = FORMATION_PEOPLE_HEADING;
  protected readonly footerNote = FORMATION_PEOPLE_FOOTER_NOTE;
  protected readonly emptyMessage = FORMATION_PEOPLE_EMPTY_MESSAGE;
  protected readonly unavailableMessage = FORMATION_PEOPLE_UNAVAILABLE_MESSAGE;
  protected readonly statusLabels = FORMATION_PERSON_STATUS_LABELS;

  protected readonly loading = signal(true);
  // Manual re-fetch trigger (e.g. after an invite). A Subject, not a BehaviorSubject, so nothing
  // emits at subscription time while the required `checklist` input is still unreadable (NG0950).
  private readonly refresh$ = new Subject<void>();

  protected readonly projectSlug = computed(() => this.checklist().formation.parent_project_slug);
  protected readonly canWrite = computed(() => this.checklist().can_write);
  protected readonly response: Signal<FormationPeopleResponse> = this.initResponse();
  protected readonly unavailable = computed(() => this.response().state === 'unavailable');
  protected readonly groups: Signal<FormationPeopleRowGroup[]> = this.initGroups();
  protected readonly isEmpty = computed(() => this.groups().length === 0);

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
      const order: FormationPeopleGroup[] = ['staff', 'invited'];

      return order
        .map((key) => ({ key, label: FORMATION_PEOPLE_GROUP_LABELS[key], rows: grouped[key].map(toFormationPersonRow) }))
        .filter((group) => group.rows.length > 0);
    });
  }
}
