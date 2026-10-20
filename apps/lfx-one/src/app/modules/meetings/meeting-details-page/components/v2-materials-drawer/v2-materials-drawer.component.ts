// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, inject, PLATFORM_ID, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { DrawerModule } from 'primeng/drawer';
import { filter } from 'rxjs';

import { MeetingMaterialsDrawerComponent } from '../../../components/meeting-materials-drawer/meeting-materials-drawer.component';

/**
 * V2's own materials drawer (#3260): V1's `lfx-meeting-materials-drawer`, its add, edit and remove
 * behaviour inherited unchanged, announced as a named modal dialog with focus handled on open and close.
 * @description `p-drawer` announces as an unnamed `complementary` landmark, never moves focus in, and
 * emits `(onHide)` only for its own Escape and mask closes (docs/architecture/frontend/drawer-pattern.md
 * § Dialog semantics). The shared drawer stays as `main` has it, because V1 renders it; this variant
 * adds the dialog role named by its title, lands focus on that title from `(onShow)`, and hands focus
 * back to the opener on every close, including the close button and a save, which set `visible` itself.
 */
@Component({
  selector: 'lfx-meeting-v2-materials-drawer',
  imports: [DrawerModule, FileUploadComponent, ButtonComponent],
  templateUrl: './v2-materials-drawer.component.html',
})
export class MeetingV2MaterialsDrawerComponent extends MeetingMaterialsDrawerComponent {
  private readonly platformId = inject(PLATFORM_ID);
  /** The title: the dialog's `aria-labelledby` target, and where focus lands on open. */
  private readonly titleRef = viewChild<ElementRef<HTMLHeadingElement>>('drawerTitle');
  /** What opened the drawer, so every close hands focus back to it. */
  private drawerTrigger: HTMLElement | null = null;

  /** Unique per instance, stable across SSR and hydration. */
  public readonly titleId = inject(_IdGenerator).getId('lfx-meeting-v2-materials-drawer-title-');
  public readonly drawerPt = { root: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': this.titleId } };

  public constructor() {
    super();
    // Every close path, not only PrimeNG's `onHide`: the close button and a save set `visible` directly.
    toObservable(this.visible)
      .pipe(
        filter((visible) => !visible),
        takeUntilDestroyed()
      )
      .subscribe(() => this.restoreFocus());
  }

  /** `p-drawer` never moves focus in on open: capture the trigger, then land on the title. */
  public onDrawerShow(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.drawerTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.titleRef()?.nativeElement.focus();
  }

  private restoreFocus(): void {
    const trigger = this.drawerTrigger;
    this.drawerTrigger = null;
    if (trigger?.isConnected) {
      trigger.focus();
    }
  }
}
