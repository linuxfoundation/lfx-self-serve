// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

import { HomeComponent } from './modules/pages/home/home.component';
import { CommitteeDashboardComponent } from './modules/project/components/committee-dashboard/committee-dashboard.component';
import { MailingListDashboardComponent } from './modules/project/components/mailing-list-dashboard/mailing-list-dashboard.component';
import { MeetingDashboardComponent } from './modules/project/components/meeting-dashboard/meeting-dashboard.component';
import { SettingsDashboardComponent } from './modules/project/components/settings-dashboard/settings-dashboard.component';
import { ProjectComponent } from './modules/project/project.component';

export const routes: Routes = [
  {
    path: '',
    component: HomeComponent,
  },
  {
    path: 'project/:slug',
    component: ProjectComponent,
  },
  {
    path: 'project/:slug/meetings',
    component: MeetingDashboardComponent,
  },
  {
    path: 'project/:slug/committees',
    component: CommitteeDashboardComponent,
  },

  {
    path: 'project/:slug/mailing-lists',
    component: MailingListDashboardComponent,
  },
  {
    path: 'project/:slug/settings',
    component: SettingsDashboardComponent,
  },
];
