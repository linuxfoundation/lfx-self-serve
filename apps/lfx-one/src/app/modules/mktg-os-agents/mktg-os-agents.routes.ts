// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import type { MktgKitTabPath } from '@lfx-one/shared/interfaces';
import { authGuard } from '@shared/guards/auth.guard';

export const MKTG_OS_AGENTS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Marketing kit',
    loadComponent: () => import('./mktg-kit/mktg-kit.component').then((m) => m.MktgKitComponent),
    canActivate: [authGuard],
  },
  {
    // The Agents tab is gone: agents are reached from their Kit family. Old links land on the Kit.
    path: 'agents',
    redirectTo: '',
    pathMatch: 'full',
  },
  {
    path: 'requests',
    title: 'Marketing requests',
    data: { title: 'Requests', tab: 'requests' satisfies MktgKitTabPath },
    loadComponent: () => import('./mktg-kit-placeholder/mktg-kit-placeholder.component').then((m) => m.MktgKitPlaceholderComponent),
    canActivate: [authGuard],
  },
  {
    path: 'access',
    title: 'Marketing access',
    data: { title: 'Access', tab: 'access' satisfies MktgKitTabPath },
    loadComponent: () => import('./mktg-kit-placeholder/mktg-kit-placeholder.component').then((m) => m.MktgKitPlaceholderComponent),
    canActivate: [authGuard],
  },
  {
    // The Documents area: every stored Marketing OS output of the project as a
    // document with revisions (list, view, restore). Static paths — must
    // precede the `:agentId` matcher.
    path: 'documents',
    title: 'Documents',
    loadComponent: () => import('./mktg-documents/mktg-documents.component').then((m) => m.MktgDocumentsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'documents/:agentKey/:documentId',
    title: 'Document',
    loadComponent: () => import('./mktg-document-view/mktg-document-view.component').then((m) => m.MktgDocumentViewComponent),
    canActivate: [authGuard],
  },
  {
    path: 'families/:familyId',
    title: 'Marketing family',
    loadComponent: () => import('./mktg-family/mktg-family.component').then((m) => m.MktgFamilyComponent),
    canActivate: [authGuard],
  },
  {
    path: 'member-360',
    title: 'Member 360',
    loadComponent: () => import('./member-360-run/member-360-run.component').then((m) => m.Member360RunComponent),
    canActivate: [authGuard],
  },
  {
    path: ':agentId',
    title: 'Agent',
    loadComponent: () => import('./mktg-agent-run/mktg-agent-run.component').then((m) => m.MktgAgentRunComponent),
    canActivate: [authGuard],
  },
];
