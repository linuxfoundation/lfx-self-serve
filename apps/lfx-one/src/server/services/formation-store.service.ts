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

export function seedFormation(formation: Formation, items: FormationItem[]): void {
  if (!formationStore.has(formation.uid)) {
    formationStore.set(formation.uid, formation);
  }
  for (const item of items) {
    if (!itemStore.has(item.uid)) {
      itemStore.set(item.uid, item);
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
  return [...itemStore.values()].filter((item) => item.formation_uid === formationUid);
}

export function putStoredItem(item: FormationItem): void {
  itemStore.set(item.uid, item);
}

export function putStoredFormation(formation: Formation): void {
  formationStore.set(formation.uid, formation);
}

export function appendActivity(activity: FormationActivity): void {
  const existing = activityStore.get(activity.formation_uid) ?? [];
  activityStore.set(activity.formation_uid, [activity, ...existing]);
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
  activityCounter = 0;
}
