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
import { currentEmployerFromWorkExperiences, invitationRequiresOrganization, normalizeToUrl } from '@lfx-one/shared/utils';
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
      return this.invitationService.acceptInvitation(context.committeeUid, context.inviteUid, { fromLfidInvite: context.fromLfidInvite });
    }

    // Resolve the pre-fill org:
    // - Invite supplied an org → pre-resolve its domain (may be missing id/website).
    // - No invite org → employer fallback via resolveCurrentEmployer(), which already calls
    //   resolveOrgDomain() internally; skip preResolveOrganization to avoid a duplicate
    //   CDP lookup that doubles latency and can repeat a find-or-create POST.
    const contextReady$: Observable<InvitationAcceptContext> = context.organization
      ? of(context).pipe(switchMap((ctx) => this.preResolveOrganization(ctx)))
      : this.resolveCurrentEmployer().pipe(map((org) => ({ ...context, organization: org ?? undefined })));

    return contextReady$.pipe(
      switchMap((ctx) =>
        from(this.openOrganizationDialog(ctx)).pipe(
          switchMap((result) => {
            if (!result?.organization) {
              return EMPTY;
            }
            return this.invitationService.acceptInvitation(ctx.committeeUid, ctx.inviteUid, {
              organization: result.organization,
              fromLfidInvite: ctx.fromLfidInvite,
            });
          })
        )
      )
    );
  }

  /**
   * Resolves the current user's employer from their profile work experiences, including
   * a best-effort domain lookup via CDP so the website field is populated.
   *
   * Used by open-group and application join flows to pre-fill the "Confirm Organization"
   * dialog the same way the invite accept flow does.
   *
   * Emits null and never throws — callers open the dialog with a blank org on any failure.
   */
  public resolveCurrentEmployer(): Observable<CommitteeOrganizationReference | null> {
    return this.http.get<WorkExperienceEntry[]>('/api/profile/work-experiences').pipe(
      take(1),
      timeout(2000),
      map((experiences) => currentEmployerFromWorkExperiences(experiences)),
      switchMap((org) => (org ? this.resolveOrgDomain(org) : of(null))),
      catchError((error) => {
        console.warn('[InvitationAcceptFlowService] resolveCurrentEmployer failed; opening dialog blank', error);
        return of(null);
      })
    );
  }

  /**
   * Attempts to resolve the website/domain for an org reference via CDP so the dialog can
   * pre-fill the URL field and prevent the "name and domain required" rejection from
   * committee-service (which always needs the domain since organization_id is stripped from
   * the payload before forwarding).
   *
   * Skips the search only when both id AND website are already present.
   * Times out after 2 s and silently returns the unmodified org on any failure.
   */
  private resolveOrgDomain(org: CommitteeOrganizationReference): Observable<CommitteeOrganizationReference> {
    if (!org?.name?.trim() || (org.id && org.website?.trim())) {
      return of(org);
    }
    return this.organizationService.searchOrganizations(org.name!).pipe(
      take(1),
      switchMap((suggestions) => {
        const match = suggestions.find((s) => s.name.toLowerCase() === org.name!.toLowerCase().trim());
        if (!match) {
          return of(org);
        }
        return this.organizationService.resolveOrganization(match.name, match.domain).pipe(
          take(1),
          map((resolved) => ({
            ...org,
            id: resolved.id || null,
            name: resolved.name || org.name,
            website: normalizeToUrl(match.domain) ?? org.website,
          }))
        );
      }),
      timeout(2000),
      catchError((error) => {
        console.warn('[InvitationAcceptFlowService] Org domain resolution failed; proceeding with unresolved org', error);
        return of(org);
      })
    );
  }

  private preResolveOrganization(ctx: InvitationAcceptContext): Observable<InvitationAcceptContext> {
    const org = ctx.organization;
    if (!org) {
      return of(ctx);
    }
    return this.resolveOrgDomain(org).pipe(map((resolvedOrg) => ({ ...ctx, organization: resolvedOrg })));
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
