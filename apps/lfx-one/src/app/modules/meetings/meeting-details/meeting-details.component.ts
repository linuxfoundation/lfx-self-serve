// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';

/**
 * The meeting details v2 page (epic #1765), rendered by {@link MeetingDetailsGateComponent} only
 * for a signed-in viewer targeted by `MEETING_V2_ENABLED_FLAG`. The pre-v2 page lives in
 * `meeting-join-v1/` and is what everyone else sees.
 *
 * This is the V2-02 scaffold (#2874): a recognisable stub that every Phase 1 component hangs off.
 * It deliberately reads no meeting data yet. When the shell lands (E1-01) it consumes the same
 * services and the same `MeetingJoinPageState` TransferState seeding v1 uses, with state derived
 * through the `meeting-view-model.utils` resolvers (E0-02) — not by lifting logic out of the v1
 * component, which stays byte-identical. Layout and conventions: `specs/010-meeting-details-redesign/v2-scaffold.md`.
 */
@Component({
  selector: 'lfx-meeting-details',
  imports: [EmptyStateComponent],
  templateUrl: './meeting-details.component.html',
})
export class MeetingDetailsComponent {}
