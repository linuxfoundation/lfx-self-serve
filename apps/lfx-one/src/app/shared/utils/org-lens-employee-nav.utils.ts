// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { SidebarMenuItem } from '@lfx-one/shared/interfaces';

/**
 * Epic #5845 — drops every item whose page (the last path segment of its `routerLink`) is in `hiddenPages`, and any
 * section that empties as a result. Returns `items` unchanged when `hiddenPages` is empty.
 */
export function withoutEmployeeViewHiddenPages(items: SidebarMenuItem[], hiddenPages: readonly string[]): SidebarMenuItem[] {
  if (hiddenPages.length === 0) return items;
  const pageOf = (item: SidebarMenuItem): string | undefined => item.routerLink?.split(/[?#]/)[0].split('/').filter(Boolean).pop();
  const keep = (list: SidebarMenuItem[]): SidebarMenuItem[] =>
    list.flatMap((item): SidebarMenuItem[] => {
      if (item.items) {
        const children = keep(item.items);
        return children.length > 0 ? [{ ...item, items: children }] : [];
      }
      const page = pageOf(item);
      return page && hiddenPages.includes(page) ? [] : [item];
    });
  return keep(items);
}
