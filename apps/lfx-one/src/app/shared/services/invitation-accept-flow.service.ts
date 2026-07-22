// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AcceptInviteOrganizationDialogComponent } from '@components/accept-invite-organization-dialog/accept-invite-organization-dialog.component';
import {
  AcceptInviteOrganizationDialogData,
  AcceptInviteOrganizationDialogResult,
  InvitationAcceptContext,
  WorkExperienceEntry,
} from '@lfx-one/shared/interfaces';
import { currentEmployerFromWorkExperiences, invitationRequiresOrganization } from '@lfx-one/shared/utils';
import { InvitationService } from '@services/invitation.service';
import { OrganizationService } from '@services/organization.service';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY, Observable, catchError, from, map, of, switchMap, take, timeout } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class InvitationAcceptFlowService {
  private readonly dialogService = inject(DialogService);
  private readonly invitationService = inject(InvitationService);
  private readonly organizationService = inject(OrganizationService);
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
          map((experiences) => ({ ...context, organization: currentEmployerFromWorkExperiences(experiences) })),
          catchError(() => of(context))
        );

    return contextReady$.pipe(
      switchMap((ctx) => this.preResolveOrganization(ctx)),
      switchMap((ctx) => from(this.openOrganizationDialog(ctx))),
      switchMap((result) => {
        if (!result?.organization) {
          return EMPTY;
        }
        return this.invitationService.acceptInvitation(context.committeeUid, context.inviteUid, result.organization);
      })
    );
  }

  /**
   * Attempts to resolve an org name to a CDP id before the dialog opens so a pre-filled
   * name with no id is not treated as a brand-new org requiring a manual website entry.
   *
   * Uses a two-step read-only approach to avoid the find-or-create side effect of calling
   * resolveOrganization directly with an empty or unverified domain:
   *  1. Search by name (read-only GET) to find the CDP-canonical domain.
   *  2. Resolve only on an exact name match, using the canonical domain so the CDP call
   *     is almost certainly a find (not a create).
   *
   * Times out after 2 s and silently falls through — the dialog handles the unresolved case.
   */
  private preResolveOrganization(ctx: InvitationAcceptContext): Observable<InvitationAcceptContext> {
    const org = ctx.organization;
    if (!org?.name?.trim() || org.id) {
      return of(ctx);
    }
    return this.organizationService.searchOrganizations(org.name).pipe(
      take(1),
      switchMap((suggestions) => {
        const match = suggestions.find((s) => s.name.toLowerCase() === org.name!.toLowerCase().trim());
        if (!match) {
          return of(ctx);
        }
        return this.organizationService.resolveOrganization(match.name, match.domain).pipe(
          take(1),
          map((resolved) => ({
            ...ctx,
            organization: { ...org, id: resolved.id || null, name: resolved.name || org.name },
          }))
        );
      }),
      timeout(2000),
      catchError((error) => {
        console.warn('[InvitationAcceptFlowService] Org pre-resolution failed; opening dialog with unresolved context', error);
        return of(ctx);
      })
    );
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
