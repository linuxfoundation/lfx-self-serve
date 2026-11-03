// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';

/**
 * Small LFX mark for the top-left of every state of the login-free ballot page (#4753). A plain `/` link into Self
 * Serve: no query, no fragment, nothing about the voter or the token.
 */
@Component({
  selector: 'lfx-vote-link-mark',
  templateUrl: './vote-link-mark.component.html',
  host: { class: 'block' },
})
export class VoteLinkMarkComponent {}
