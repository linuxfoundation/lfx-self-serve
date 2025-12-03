// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PendingActionItem } from '../interfaces';

/**
 * Core Developer action items
 */
export const CORE_DEVELOPER_ACTION_ITEMS: PendingActionItem[] = [
  {
    type: 'Fix Bug',
    badge: 'React',
    text: 'CI pipeline failed on latest PR due to linting errors in React components.',
    icon: 'fa-light fa-circle-exclamation',
    severity: 'warn',
    buttonText: 'Fix CI Error',
  },
  {
    type: 'Review PR',
    badge: 'Kubernetes',
    text: 'A teammate requested your review on k8s-config-refactor before merge deadline.',
    icon: 'fa-light fa-file-lines',
    severity: 'warn',
    buttonText: 'Review Pull Request',
  },
  {
    type: 'Update Dependency',
    badge: 'React',
    text: 'Critical React security patch available (react-dom 18.3.1).',
    icon: 'fa-light fa-shield',
    severity: 'warn',
    buttonText: 'Update Package',
  },
];

/**
 * Maintainer action items
 */
export const MAINTAINER_ACTION_ITEMS: PendingActionItem[] = [
  {
    type: 'Merge PRs',
    badge: 'Kubernetes',
    text: '3 approved PRs awaiting merge.',
    icon: 'fa-light fa-file-lines',
    severity: 'warn',
    buttonText: 'Merge Now',
  },
  {
    type: 'Hotfix',
    badge: 'React',
    text: 'Prod bug in ClusterView.',
    icon: 'fa-light fa-circle-exclamation',
    severity: 'warn',
    buttonText: 'Open Fix',
  },
  {
    type: 'Audit License',
    badge: 'General',
    text: 'GPL dependency flagged.',
    icon: 'fa-light fa-shield',
    severity: 'warn',
    buttonText: 'Review Report',
  },
];

/**
 * Board Member action items
 */
export const BOARD_MEMBER_ACTION_ITEMS: PendingActionItem[] = [
  {
    type: 'Review Meeting Materials',
    badge: 'Q4 Board',
    text: 'Review Q4 Board Meeting Agenda and Materials',
    icon: 'fa-light fa-file-check',
    severity: 'info',
    buttonText: 'Review',
  },
  {
    type: 'Submit Survey',
    badge: 'Due Today',
    text: 'Submit Quarterly NPS Survey',
    icon: 'fa-light fa-chart-line',
    severity: 'warn',
    buttonText: 'Submit',
  },
];
