// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { TagComponent } from '@components/tag/tag.component';

// LFXV2-1902: the Org Lens meetings live list and its Snowflake-backed BFF read
// path were retired (per-invitee PII served from the analytics lane with no
// operational-plane check — ADR-0038). This page is now a "coming soon"
// placeholder; the /org/meetings route and sidebar tab intentionally still
// resolve this component.
@Component({
  selector: 'lfx-org-meetings',
  imports: [TagComponent],
  templateUrl: './org-meetings.component.html',
})
export class OrgMeetingsComponent {}
