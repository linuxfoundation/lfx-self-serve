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

    if (this.isTokenExpired(token)) {
      this.redirectToError('expired');
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
          const reason = (err?.error?.code as string) === 'INVITE_EXPIRED' ? 'expired' : 'failed';
          this.redirectToError(reason);
        },
      });
  }

  private isTokenExpired(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      // Base64url → base64 padding for atob
      const padded = parts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
      const payload = JSON.parse(atob(padded)) as InviteTokenPayload;
      return Date.now() / 1000 > payload.exp;
    } catch {
      return true;
    }
  }

  private redirectToError(reason: string): void {
    this.isProcessing.set(false);
    void this.router.navigate(['/invite/error'], { queryParams: { reason }, replaceUrl: true });
  }
}
