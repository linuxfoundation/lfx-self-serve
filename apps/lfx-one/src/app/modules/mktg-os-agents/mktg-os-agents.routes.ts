// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';
import { authGuard } from '@shared/guards/auth.guard';

export const MKTG_OS_AGENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./mktg-os-agents/mktg-os-agents.component').then((m) => m.MktgOsAgentsComponent),
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
    path: ':agentId',
    title: 'Agent',
    loadComponent: () => import('./mktg-agent-run/mktg-agent-run.component').then((m) => m.MktgAgentRunComponent),
    canActivate: [authGuard],
  },
];
