// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MenuComponent } from '@components/menu/menu.component';
import { MessageComponent } from '@components/message/message.component';
import {
  AddAccountDialogData,
  ConnectedIdentityFull,
  EnrichedIdentity,
  IdentityProvider,
  RemoveIdentityDialogData,
  VerifyIdentityDialogData,
} from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, map, of, startWith, Subject, switchMap, take } from 'rxjs';

import { AddAccountDialogComponent } from '../components/add-account-dialog/add-account-dialog.component';
import { RemoveIdentityDialogComponent } from '../components/remove-identity-dialog/remove-identity-dialog.component';
import { VerifyIdentityDialogComponent } from '../components/verify-identity-dialog/verify-identity-dialog.component';

interface IdentitiesState {
  identities: EnrichedIdentity[];
  loaded: boolean;
}

@Component({
  selector: 'lfx-profile-identities',
  imports: [CardComponent, ButtonComponent, MenuComponent, MessageComponent],
  providers: [DialogService],
  templateUrl: './profile-identities.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileIdentitiesComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly identitiesLoadError = signal(false);
  private readonly conflictDismissed = signal(false);
  // Captured once from the URL snapshot in ngOnInit. Using a plain signal instead of
  // toSignal(queryParams) avoids a subtle invariant: clearQueryParams() uses
  // history.replaceState (not router.navigate), which does not emit on the Router's
  // queryParams observable. If that ever changes to router.navigate, this approach
  // stays correct while a queryParams-derived computed would silently break.
  private readonly conflictDetected = signal(false);
  public readonly conflictBanner: Signal<boolean> = computed(() => this.conflictDetected() && !this.conflictDismissed());

  public readonly identities: Signal<ConnectedIdentityFull[]> = computed(() =>
    this.identitiesState()
      .identities.filter((id) => id.platform !== 'lfid' && id.displayState !== 'hidden')
      .map((enriched) => this.mapToConnectedIdentity(enriched))
  );
  public readonly loading: Signal<boolean> = computed(() => !this.identitiesState().loaded);
  public readonly isEmpty: Signal<boolean> = computed(
    () => !this.identitiesLoadError() && this.identitiesState().loaded && this.identitiesState().identities.length === 0
  );

  public readonly unverifiedIdentities: Signal<ConnectedIdentityFull[]> = computed(() => this.identities().filter((i) => i.state === 'unverified'));
  public readonly verifiedIdentities: Signal<ConnectedIdentityFull[]> = computed(() => this.identities().filter((i) => i.state === 'verified'));
  public readonly hasUnverified: Signal<boolean> = computed(() => this.unverifiedIdentities().length > 0);
  public readonly menuItemsMap: Signal<Map<string, MenuItem[]>> = this.initMenuItemsMap();

  private readonly refreshTrigger$ = new Subject<void>();
  private readonly identitiesState: Signal<IdentitiesState> = this.initIdentitiesState();

  public ngOnInit(): void {
    const params = this.route.snapshot.queryParams;

    if (params['success'] === 'identity_linked') {
      this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Identity linked successfully.' });
      this.refreshTrigger$.next();
      this.clearQueryParams();
    } else if (params['error'] === 'already_linked') {
      this.conflictDetected.set(true);
      this.clearQueryParams();
    } else if (params['error']) {
      const errorMap: Record<string, string> = {
        social_auth_failed: 'Social authentication failed. Please try again.',
        invalid_state: 'Security validation failed. Please try again.',
        link_failed: 'Failed to link identity. Please try again.',
        social_verification_failed: 'Identity verification failed. Please try again.',
        invalid_provider: 'Invalid identity provider specified.',
        no_management_token: 'Authorization expired. Please try again.',
        no_identity_token: 'No identity token received. Please try again.',
      };
      this.messageService.add({ severity: 'error', summary: 'Error', detail: errorMap[params['error']] || 'An error occurred. Please try again.' });
      this.clearQueryParams();
    }
  }

  public dismissConflictBanner(): void {
    this.conflictDismissed.set(true);
    this.clearQueryParams();
  }

  public onVerify(identity: ConnectedIdentityFull): void {
    const dialogRef = this.dialogService.open(VerifyIdentityDialogComponent, {
      header: 'Verify identity',
      width: '480px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { identity } as VerifyIdentityDialogData,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result) => {
      if (result) {
        this.refreshTrigger$.next();
      }
    });
  }

  public onRemove(identity: ConnectedIdentityFull): void {
    // For identities linked in Auth0, ensure management token is valid before proceeding
    if (identity.auth0UserId) {
      this.userService
        .getProfileAuthStatus()
        .pipe(take(1))
        .subscribe((status) => {
          if (!status.authorized) {
            window.location.href = '/api/profile/auth/start?returnTo=/profile/identities';
            return;
          }
          this.openRemoveDialog(identity);
        });
    } else {
      this.openRemoveDialog(identity);
    }
  }

  public onAdd(): void {
    const existingProviders = this.identities().map((i) => i.provider);
    const dialogRef = this.dialogService.open(AddAccountDialogComponent, {
      header: 'Add identity',
      width: '480px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { existingProviders } as AddAccountDialogData,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result) => {
      if (result) {
        this.refreshTrigger$.next();
      }
    });
  }

  private clearQueryParams(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    // Use history API instead of router.navigate to avoid triggering route re-evaluation
    // that could destroy component state or re-run lifecycle hooks.
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }

  private openRemoveDialog(identity: ConnectedIdentityFull): void {
    const dialogRef = this.dialogService.open(RemoveIdentityDialogComponent, {
      header: identity.state === 'verified' ? 'Remove verified identity' : 'Remove unverified identity',
      width: '480px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { identity } as RemoveIdentityDialogData,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result) => {
      if (result) {
        this.userService
          .rejectIdentity(identity.id, identity.provider, identity.auth0UserId)
          .pipe(take(1))
          .subscribe({
            next: () => this.refreshTrigger$.next(),
            error: (err: HttpErrorResponse) => {
              if (err.error?.error === 'management_token_required' && err.error?.authorize_url) {
                window.location.href = err.error.authorize_url;
                return;
              }
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to remove identity. Please try again.' });
            },
          });
      }
    });
  }

  private mapToConnectedIdentity(enriched: EnrichedIdentity): ConnectedIdentityFull {
    return {
      id: enriched.id,
      provider: enriched.platform as IdentityProvider,
      identifier: enriched.value,
      state: enriched.displayState === 'verified' ? 'verified' : 'unverified',
      icon: enriched.icon,
      isPrimary: false,
      ...(enriched.auth0UserId ? { auth0UserId: enriched.auth0UserId } : {}),
    };
  }

  private initMenuItemsMap(): Signal<Map<string, MenuItem[]>> {
    return computed(() => {
      const map = new Map<string, MenuItem[]>();
      for (const identity of this.identities()) {
        map.set(identity.id, [{ label: 'Remove', icon: 'fa-light fa-trash', styleClass: 'text-red-500', command: () => this.onRemove(identity) }]);
      }
      return map;
    });
  }

  private initIdentitiesState(): Signal<IdentitiesState> {
    return toSignal(
      this.refreshTrigger$.pipe(
        startWith(undefined),
        switchMap(() => {
          this.identitiesLoadError.set(false);
          return this.userService.getIdentities().pipe(
            catchError(() => {
              // Any load failure hides the list entirely — a missing Auth0 overlay
              // would mis-label every CDP identity as "unverified".
              this.identitiesLoadError.set(true);
              return of([] as EnrichedIdentity[]);
            })
          );
        }),
        map((identities): IdentitiesState => ({ identities, loaded: true }))
      ),
      { initialValue: { identities: [] as EnrichedIdentity[], loaded: false } }
    );
  }
}
