// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';

/**
 * Admin landing page for the mentorship module.
 *
 * Mirrors `MyInitiativesComponent`'s shape: signal-driven state, `toSignal`
 * over a computed request observable, and a child list component that owns
 * card rendering + empty state. Search + status filter are lifted here (not in
 * the list child) so a future paginated "load more" driver can share the same
 * filter signals without prop-drilling.
 */
@Component({
  selector: 'lfx-mentorship-admin',
  templateUrl: './admin.component.html',
})
export class AdminComponent {}
