// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

import { ProjectLayoutComponent } from './layouts/project-layout/project-layout.component';
import { HomeComponent } from './modules/pages/home/home.component';
import { CommitteeDashboardComponent } from './modules/project/committees/committee-dashboard/committee-dashboard.component';
import { CommitteeViewComponent } from './modules/project/committees/committee-view/committee-view.component';
import { MailingListDashboardComponent } from './modules/project/mailing-lists/mailing-list-dashboard/mailing-list-dashboard.component';
import { MeetingDashboardComponent } from './modules/project/meetings/meeting-dashboard/meeting-dashboard.component';
import { MeetingManageComponent } from './modules/project/meetings/components/meeting-manage/meeting-manage.component';
import { SettingsDashboardComponent } from './modules/project/settings/settings-dashboard/settings-dashboard.component';
import { ProjectComponent } from './modules/project/dashboard/project-dashboard/project.component';

export const routes: Routes = [
  {
    path: '',
    component: HomeComponent,
  },
  {
    path: 'project/:slug',
    component: ProjectLayoutComponent,
    children: [
      {
        path: '',
        component: ProjectComponent,
      },
      {
        path: 'meetings',
        component: MeetingDashboardComponent,
      },
      {
        path: 'meetings/create',
        component: MeetingManageComponent,
      },
      {
        path: 'meetings/:id/edit',
        component: MeetingManageComponent,
      },
      {
        path: 'committees',
        component: CommitteeDashboardComponent,
      },
      {
        path: 'committees/:id',
        component: CommitteeViewComponent,
      },
      {
        path: 'mailing-lists',
        component: MailingListDashboardComponent,
      },
      {
        path: 'settings',
        component: SettingsDashboardComponent,
      },
    ],
  },
];
