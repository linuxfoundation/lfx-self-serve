// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer } from '@angular/common';
import { Component, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HeaderComponent } from '@components/header/header.component';
import { InviteTokenPayload } from '@lfx-one/shared/interfaces';
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
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly isProcessing = signal(true);

  public ngOnInit(): void {
    // Skip on SSR — the auth guard and redirect logic run browser-side only.
    if (isPlatformServer(this.platformId)) return;

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
          window.location.href = res.return_url;
        },
        error: (err) => {
          const code = err?.error?.code as string;
<<<<<<< HEAD
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
      if (typeof payload.exp !== 'number' || !isFinite(payload.exp)) return 'invalid';
      return Date.now() / 1000 > payload.exp ? 'expired' : null;
    } catch {
      return 'invalid';
    }
  }

  private redirectToError(reason: string): void {
    this.isProcessing.set(false);
    void this.router.navigate(['/invite/error'], { queryParams: { reason }, replaceUrl: true });
  }
}
