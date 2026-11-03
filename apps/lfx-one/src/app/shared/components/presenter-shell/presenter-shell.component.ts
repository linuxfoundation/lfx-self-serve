// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { VotePresenterPhase } from '@lfx-one/shared/interfaces';

/**
 * Chrome-less dark frame and phase switch for presenter views (loading, error, empty, open, ended).
 * @description Owns the shell DOM only: the frame, the LFX header with the status pill, the footers (Exit, and the
 * "updated ago" text) and the loading and error screens. Each phase's content is projected: `[presenterEmpty]`,
 * `[presenterOpen]`, `[presenterEnded]`, plus `[footerActions]` beside Exit on the open footer. It provides nothing:
 * the confirmation dialogs, Esc handling, focus return and the captured-vote rule stay with the consumer, which
 * handles the `exit` and `retry` outputs. The open footer precedes the open content in the DOM (keyboard order, #4146)
 * and `order-last` keeps it visually at the bottom. The host is `display: contents` so `<main>` lays out as before.
 */
@Component({
  selector: 'lfx-presenter-shell',
  imports: [ButtonComponent, NgTemplateOutlet],
  templateUrl: './presenter-shell.component.html',
  host: { class: 'contents' },
})
export class PresenterShellComponent {
  // === Inputs ===
  public readonly phase = input.required<VotePresenterPhase>();
  public readonly statusPill = input<string>('');
  /** The foundation or committee line under the LFX mark; omitted when empty. */
  public readonly context = input<string | null | undefined>(null);
  public readonly updatedAgoSeconds = input<number | null>(null);

  // === Outputs ===
  public readonly exit = output<void>();
  public readonly retry = output<void>();
}
