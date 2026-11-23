// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { ACCOUNT_CHANGES_REVERTED_MESSAGE } from '@lfx-one/shared/constants';
import { AccountPageForm } from '@lfx-one/shared/interfaces';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { finalize, map, Observable, of } from 'rxjs';

import { DiscardChangesModalComponent } from '../components/discard-changes-modal/discard-changes-modal.component';

/**
 * Holds the Account & Settings page that has fields to save (#6070). The page registers itself; the header save bar reads
 * `dirty` and calls `save` and `revert`, and `accountUnsavedChangesGuard` asks before leaving while there are changes. A
 * reload or a closed tab gets the browser's own leave prompt.
 */
@Injectable({ providedIn: 'root' })
export class AccountUnsavedChangesService {
  private readonly modal = inject(UiModalService);
  private readonly toast = inject(UiToastService);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly page = signal<AccountPageForm | null>(null);

  public readonly dirty = computed(() => this.page()?.dirty() ?? false);
  public readonly saving = computed(() => this.page()?.saving() ?? false);

  /** Registers the shown page until `destroyRef` ends, normally the page component's own. */
  public register(page: AccountPageForm, destroyRef: DestroyRef): void {
    this.page.set(page);
    if (this.isBrowser) this.document.defaultView?.addEventListener('beforeunload', this.onBeforeUnload);
    destroyRef.onDestroy(() => {
      if (this.page() !== page) return;
      this.page.set(null);
      this.document.defaultView?.removeEventListener('beforeunload', this.onBeforeUnload);
    });
  }

  public save(): void {
    if (!this.saving()) this.page()?.save();
  }

  public revert(): void {
    const page = this.page();
    if (!page) return;
    page.revert();
    this.toast.show({ variant: 'dark', message: ACCOUNT_CHANGES_REVERTED_MESSAGE });
  }

  /** `true` to go ahead: straight away with nothing unsaved, otherwise once the user chooses "Discard changes". */
  public confirmLeave(): Observable<boolean> {
    if (!this.dirty()) return of(true);
    const ref = this.modal.open<boolean>(DiscardChangesModalComponent, { role: 'alertdialog', describedBy: true, autoFocus: '[data-autofocus] button' });
    // A newer navigation, such as a second Back, drops this one's guard; the dialog goes with it rather than stranding over the page.
    return ref.closed.pipe(
      map((discard) => discard === true),
      finalize(() => ref.close())
    );
  }

  private readonly onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!this.dirty()) return;
    event.preventDefault();
    // Older browsers need returnValue set to show the prompt.
    event.returnValue = '';
  };
}
