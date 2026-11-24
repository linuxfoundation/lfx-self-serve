// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { EnrichedIdentity } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { catchError, EMPTY, startWith, switchMap } from 'rxjs';

import { AccountLinuxEmailComponent } from './account-linux-email.component';

/**
 * Account & Settings › Linux.com email (#6075). On the hub this card sat on the Identities tab, which handed it the verified
 * addresses to forward to; here the page loads them itself and refreshes them with the identities.
 */
@Component({
  selector: 'lfx-account-linux-email-page',
  imports: [AccountLinuxEmailComponent],
  templateUrl: './account-linux-email-page.component.html',
})
export class AccountLinuxEmailPageComponent {
  private readonly userService = inject(UserService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly identities: Signal<EnrichedIdentity[]> = this.initIdentities();

  // Browser only, as on the Identities page: an SSR fetch would re-run the server's identity reconcile. A failed refresh keeps
  // the last list; the card still offers the primary address it gets with the alias.
  private initIdentities(): Signal<EnrichedIdentity[]> {
    if (!isPlatformBrowser(this.platformId)) return signal<EnrichedIdentity[]>([]);
    return toSignal(
      this.userService.identitiesRefresh$.pipe(
        startWith(undefined),
        switchMap(() =>
          this.userService.getIdentities().pipe(
            catchError((error: unknown) => {
              console.error('Failed to load identities for Linux.com email:', error);
              return EMPTY;
            })
          )
        )
      ),
      { initialValue: [] as EnrichedIdentity[] }
    );
  }
}
