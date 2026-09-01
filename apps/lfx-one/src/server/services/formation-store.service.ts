// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Formation, FormationActivity, FormationItem } from '@lfx-one/shared/interfaces';

/**
 * In-memory write store backing the fixture-only Formation Checklist / Formations queue data
 * (GH-1958) — deliberately not Valkey/durable-cache-backed, since it stands in for a real backend
 * that doesn't exist yet (see `formation-backend.helper.ts`) rather than caching one that does.
 *
 * Known limitation, accepted for Epic 1: this state is per-process. In a multi-replica deployment
 * a write on one pod isn't visible on another, so a completed/skipped item can appear to "revert"
 * on a subsequent request routed to a different pod. TODO(#1957): this store is deleted entirely
 * once the real formation-service is the source of truth — not worth solving with a shared cache
 * for data that's synthetic and short-lived by design.
 */
const itemStore = new Map<string, FormationItem>();
const formationStore = new Map<string, Formation>();
const activityStore = new Map<string, FormationActivity[]>();
let activityCounter = 0;

/**
 * Secondary index so `getStoredItemsForFormation` (called on every checklist read and every
 * `refreshFormationReadiness`) doesn't full-scan `itemStore.values()` per request — keeps
 * `getStoredItem`'s O(1) flat lookup by item uid alone (the only key callers have) while this index
 * answers "every item for formation X" in O(items in that formation) instead of O(all items ever seen).
 */
const itemUidsByFormation = new Map<string, Set<string>>();

/** Per-formation activity cap — this is a long-lived process-global Map with no eviction otherwise; bounds it against unbounded growth over the process lifetime. */
const MAX_ACTIVITY_PER_FORMATION = 200;

/**
 * Caps the number of distinct formations this process retains — otherwise `formationStore`/
 * `itemStore` grow by one formation (~5-18 items) for every project ever viewed, for the lifetime
 * of the process. Eviction is insertion-order (FIFO via `Map`'s iteration order), not true LRU —
 * a formation seeded long ago but viewed a moment ago can still be evicted first. Acceptable for
 * fixture-only, short-lived-by-design data (see the store's own TODO(#1957) deletion note); a real
 * LRU would need to re-insert on every access, which for this store isn't worth the complexity.
 */
export const MAX_FORMATIONS_TRACKED = 500;

function indexItem(item: FormationItem): void {
  let uids = itemUidsByFormation.get(item.formation_uid);
  if (!uids) {
    uids = new Set();
    itemUidsByFormation.set(item.formation_uid, uids);
  }
  uids.add(item.uid);
}

function evictOldestFormationIfOverCapacity(): void {
  if (formationStore.size <= MAX_FORMATIONS_TRACKED) return;
  const oldestUid = formationStore.keys().next().value;
  if (oldestUid === undefined) return;

  formationStore.delete(oldestUid);
  const itemUids = itemUidsByFormation.get(oldestUid);
  if (itemUids) {
    for (const itemUid of itemUids) itemStore.delete(itemUid);
    itemUidsByFormation.delete(oldestUid);
  }
  activityStore.delete(oldestUid);
}

export function seedFormation(formation: Formation, items: FormationItem[]): void {
  if (!formationStore.has(formation.uid)) {
    formationStore.set(formation.uid, formation);
    evictOldestFormationIfOverCapacity();
  }
  for (const item of items) {
    if (!itemStore.has(item.uid)) {
      itemStore.set(item.uid, item);
      indexItem(item);
    }
  }
}

export function getStoredFormation(uid: string): Formation | undefined {
  return formationStore.get(uid);
}

export function getStoredItem(uid: string): FormationItem | undefined {
  return itemStore.get(uid);
}

export function getStoredItemsForFormation(formationUid: string): FormationItem[] {
  const uids = itemUidsByFormation.get(formationUid);
  if (!uids) return [];
  const items: FormationItem[] = [];
  for (const uid of uids) {
    const item = itemStore.get(uid);
    if (item) items.push(item);
  }
  return items;
}

export function putStoredItem(item: FormationItem): void {
  itemStore.set(item.uid, item);
  indexItem(item);
}

export function putStoredFormation(formation: Formation): void {
  formationStore.set(formation.uid, formation);
}

export function appendActivity(activity: FormationActivity): void {
  const existing = activityStore.get(activity.formation_uid) ?? [];
  activityStore.set(activity.formation_uid, [activity, ...existing].slice(0, MAX_ACTIVITY_PER_FORMATION));
}

export function getActivityForFormation(formationUid: string): FormationActivity[] {
  return activityStore.get(formationUid) ?? [];
}

export function getActivityForItem(formationUid: string, itemUid: string): FormationActivity[] {
  return getActivityForFormation(formationUid).filter((activity) => activity.formation_item_uid === itemUid);
}

export function nextActivityUid(): string {
  activityCounter += 1;
  return `formation-activity:${Date.now()}:${activityCounter}`;
}

/** Test-only — clears all three stores and the activity counter so specs don't depend on inter-test uid uniqueness. Never call from application code. */
export function resetFormationStoreForTests(): void {
  itemStore.clear();
  formationStore.clear();
  activityStore.clear();
  itemUidsByFormation.clear();
  activityCounter = 0;
}
