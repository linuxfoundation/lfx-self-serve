// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HeaderComponent } from '@components/header/header.component';
import { InviteTokenPayload, PendingCommitteeInviteForOrg } from '@lfx-one/shared/interfaces';
import { InvitationAcceptFlowService } from '@services/invitation-accept-flow.service';
import { InviteService } from '@services/invite.service';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-invite',
  imports: [HeaderComponent],
  templateUrl: './invite.component.html',
})
export class InviteComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly inviteService = inject(InviteService);
  private readonly invitationAcceptFlow = inject(InvitationAcceptFlowService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly isProcessing = signal(true);

  public ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const token = this.route.snapshot.queryParamMap.get('token');

    if (!token) {
      this.redirectToError('missing');
      return;
    }

    const tokenStatus = this.checkToken(token);
    if (tokenStatus) {
      this.redirectToError(tokenStatus === 'expired' ? 'expired' : 'missing');
      return;
    }

    this.inviteService
      .acceptInvite(token)
      .pipe(take(1))
      .subscribe({
        next: (res) => {
          if (res.pending_committee_invite) {
            this.collectOrgAndAccept(res.pending_committee_invite, res.return_url);
          } else {
            window.location.href = res.return_url;
          }
        },
        error: (err) => {
          const code = err?.error?.code as string;
          let reason: string;
          if (code === 'INVITE_EXPIRED') {
            reason = 'expired';
          } else if (code === 'VALIDATION_ERROR') {
            reason = 'missing';
          } else {
            reason = 'failed';
          }
          this.redirectToError(reason);
        },
      });
  }

  private collectOrgAndAccept(invite: PendingCommitteeInviteForOrg, returnUrl: string): void {
    this.isProcessing.set(false);
    let accepted = false;
    this.invitationAcceptFlow
      .accept({
        committeeUid: invite.committee_uid,
        inviteUid: invite.invite_uid,
        committeeName: invite.committee_name,
        organization: invite.organization,
        organization_required: true,
      })
      .pipe(take(1))
      .subscribe({
        next: () => {
          // Committee invite accepted with org — redirect to the group page now that the user is a member.
          accepted = true;
          window.location.href = returnUrl;
        },
        error: () => {
          // Committee accept failed; LFID accept already succeeded. Redirect anyway — the user can
          // retry accepting the committee invite from My Groups.
          window.location.href = returnUrl;
        },
        complete: () => {
          if (!accepted) {
            // User dismissed the org dialog without confirming. The LFID accept already succeeded
            // but the committee invite is still pending. Navigate home so the user isn't left on a
            // blank page — they can accept the invite from My Groups.
            void this.router.navigate(['/']);
          }
        },
      });
  }

  private checkToken(token: string): 'expired' | 'invalid' | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return 'invalid';
      // Base64url → base64 padding for atob
      const padded = parts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
      const payload = JSON.parse(atob(padded)) as InviteTokenPayload;
      if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return 'invalid';
      return Date.now() / 1000 >= payload.exp ? 'expired' : null;
    } catch {
      return 'invalid';
    }
  }

  private redirectToError(reason: string): void {
    this.isProcessing.set(false);
    void this.router.navigate(['/invite/error'], { queryParams: { reason }, replaceUrl: true });
  }
}
