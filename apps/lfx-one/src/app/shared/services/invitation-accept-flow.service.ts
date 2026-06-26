// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AcceptInviteOrganizationDialogComponent } from '@components/accept-invite-organization-dialog/accept-invite-organization-dialog.component';
import {
  AcceptInviteOrganizationDialogData,
  AcceptInviteOrganizationDialogResult,
  CommitteeOrganizationReference,
  InvitationAcceptContext,
  WorkExperienceEntry,
} from '@lfx-one/shared/interfaces';
import { invitationRequiresOrganization } from '@lfx-one/shared/utils';
import { InvitationService } from '@services/invitation.service';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY, Observable, catchError, from, map, of, switchMap, take } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class InvitationAcceptFlowService {
  private readonly dialogService = inject(DialogService);
  private readonly invitationService = inject(InvitationService);
  private readonly http = inject(HttpClient);

  /**
   * Accepts a committee invitation, opening the organization dialog when the committee
   * requires it. Emits nothing when the user cancels the dialog.
   *
   * When the invite has no pre-filled organization, the user's current employer from
   * their work experience is used to pre-fill the dialog so they don't have to re-enter
   * an org they've already associated with their profile.
   */
  public accept(context: InvitationAcceptContext): Observable<void> {
    const requiresOrganization = invitationRequiresOrganization(context);

    if (!requiresOrganization) {
      return this.invitationService.acceptInvitation(context.committeeUid, context.inviteUid);
    }

    // Resolve the pre-fill org: use the invite's org when present, otherwise fall back to
    // the user's current employer from their profile (fails silently — dialog opens blank).
    const contextReady$: Observable<InvitationAcceptContext> = context.organization
      ? of(context)
      : this.http.get<WorkExperienceEntry[]>('/api/profile/work-experiences').pipe(
          take(1),
          map((experiences) => ({ ...context, organization: this.currentEmployerFromProfile(experiences) })),
          catchError(() => of(context))
        );

    return contextReady$.pipe(
      switchMap((ctx) => from(this.openOrganizationDialog(ctx))),
      switchMap((result) => {
        if (!result?.organization) {
          return EMPTY;
        }
        return this.invitationService.acceptInvitation(context.committeeUid, context.inviteUid, result.organization);
      })
    );
  }

  private currentEmployerFromProfile(experiences: WorkExperienceEntry[]): CommitteeOrganizationReference | null {
    if (!experiences.length) return null;
    const current =
      experiences.find((e) => !e.endDate) ?? [...experiences].sort((a, b) => this.monthYearToOrdinal(b.startDate) - this.monthYearToOrdinal(a.startDate))[0];
    return { name: current.organization, id: current.organizationId ?? null };
  }

  // Converts "MMM YYYY" (BFF date format) to a sortable ordinal. Avoids new Date() on
  // non-ISO strings, which is unreliable in Safari.
  private monthYearToOrdinal(monthYear: string): number {
    const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const [mon, yr] = monthYear.split(' ');
    const month = MONTHS[mon] ?? 0;
    const year = parseInt(yr, 10);
    return isNaN(year) ? 0 : year * 12 + month;
  }

  private openOrganizationDialog(context: InvitationAcceptContext): Promise<AcceptInviteOrganizationDialogResult | null> {
    const ref = this.dialogService.open(AcceptInviteOrganizationDialogComponent, {
      header: 'Confirm Organization',
      width: '32rem',
      modal: true,
      closable: true,
      data: {
        committeeName: context.committeeName,
        organization: context.organization ?? null,
      } satisfies AcceptInviteOrganizationDialogData,
    });

    if (!ref) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      ref.onClose.pipe(take(1)).subscribe((result: AcceptInviteOrganizationDialogResult | null) => resolve(result ?? null));
    });
  }
}
