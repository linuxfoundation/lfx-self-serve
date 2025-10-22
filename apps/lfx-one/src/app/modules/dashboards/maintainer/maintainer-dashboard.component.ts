// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { MyProjectsComponent } from '../components/my-projects/my-projects.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';
import { RecentProgressComponent } from '../components/recent-progress/recent-progress.component';

@Component({
  selector: 'lfx-maintainer-dashboard',
  standalone: true,
  imports: [RecentProgressComponent, PendingActionsComponent, MyMeetingsComponent, MyProjectsComponent],
  templateUrl: './maintainer-dashboard.component.html',
  styleUrl: './maintainer-dashboard.component.scss',
})
export class MaintainerDashboardComponent {}
