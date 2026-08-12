// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';

import { EmptyStateComponent } from '../../../shared/components/empty-state/empty-state.component';

/**
 * Social Listening — Foundation Lens page (ED-only). Scaffolding shell for LFXV2-3002;
 * the sidebar PCC deeplink is replaced by the feed slice (LFXV2-3016).
 */
@Component({
  selector: 'lfx-social-listening',
  imports: [EmptyStateComponent],
  templateUrl: './social-listening.component.html',
  styleUrl: './social-listening.component.scss',
})
export class SocialListeningComponent {}
