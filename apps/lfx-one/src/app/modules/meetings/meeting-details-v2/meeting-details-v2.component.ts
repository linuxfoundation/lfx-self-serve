// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';

/**
 * Placeholder for the meeting details v2 page (#2873). Exists so
 * {@link MeetingDetailsGateComponent}'s enabled branch has something to render and the gate can be
 * shipped and tested on its own; #2874 replaces this body with the real v2 scaffold.
 *
 * Deliberately renders nothing that reads the meeting payload — the gate ships before any v2 data
 * flow exists, and nothing here should imply a contract that #2874 then has to honour.
 */
@Component({
  selector: 'lfx-meeting-details-v2',
  templateUrl: './meeting-details-v2.component.html',
})
export class MeetingDetailsV2Component {}
