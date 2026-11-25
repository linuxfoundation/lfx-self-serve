// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { withoutEmployeeViewHiddenPages } from './org-lens-employee-nav.utils';

const items: SidebarMenuItem[] = [
  { label: 'Dashboard', routerLink: '/company/acme-inc/overview' },
  { label: 'Memberships', routerLink: '/company/acme-inc/memberships' },
  {
    label: 'Company Engagement',
    isSection: true,
    items: [
      { label: 'People', routerLink: '/company/acme-inc/people?range=1y' },
      { label: 'Events', routerLink: '/company/acme-inc/events' },
    ],
  },
  { label: 'Only hidden', isSection: true, items: [{ label: 'Groups', routerLink: '/company/acme-inc/groups' }] },
];

describe('withoutEmployeeViewHiddenPages', () => {
  it('changes nothing while the hidden list is empty', () => {
    expect(withoutEmployeeViewHiddenPages(items, [])).toBe(items);
  });

  it('drops hidden pages at any depth, ignoring the query string', () => {
    const result = withoutEmployeeViewHiddenPages(items, ['memberships', 'people']);

    expect(result.map((item) => item.label)).toEqual(['Dashboard', 'Company Engagement', 'Only hidden']);
    expect(result[1].items?.map((item) => item.label)).toEqual(['Events']);
  });

  it('removes a section that empties', () => {
    const result = withoutEmployeeViewHiddenPages(items, ['groups']);

    expect(result.map((item) => item.label)).not.toContain('Only hidden');
  });
});
