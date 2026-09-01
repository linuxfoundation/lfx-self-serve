// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Formation, FormationActivity, FormationItem } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import {
  appendActivity,
  getActivityForFormation,
  getActivityForItem,
  getStoredFormation,
  getStoredItem,
  getStoredItemsForFormation,
  MAX_FORMATIONS_TRACKED,
  nextActivityUid,
  putStoredFormation,
  putStoredItem,
  resetFormationStoreForTests,
  seedFormation,
} from './formation-store.service';

let counter = 0;

function buildFormation(overrides: Partial<Formation> = {}): Formation {
  counter += 1;
  return {
    uid: `formation:store-test-${counter}`,
    parent_project_uid: `project-${counter}`,
    parent_project_slug: `slug-${counter}`,
    parent_project_name: `Project ${counter}`,
    entity_type: 'foundation',
    template_uid: 'template-1',
    template_version: 1,
    state: 'active',
    sub_stage: 'engaged',
    announcement_date: null,
    is_activating: false,
    gating_items_open: 0,
    gating_items_total: 0,
    blocking_item_title: null,
    lead: null,
    proposer: null,
    subtitle: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function buildItem(formationUid: string, overrides: Partial<FormationItem> = {}): FormationItem {
  counter += 1;
  return {
    uid: `formation-item:store-test-${counter}`,
    formation_uid: formationUid,
    template_item_key: `key-${counter}`,
    section_key: 'section',
    section_title: 'Section',
    title: `Item ${counter}`,
    status: 'not_started',
    is_gating: false,
    owner_team: null,
    owner: null,
    due_date: null,
    action: 'manual',
    action_href: null,
    detail: null,
    notes: null,
    links: [],
    sub_items: [],
    skip_reason: null,
    can_complete: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('formation-store.service', () => {
  describe('seedFormation', () => {
    it('is idempotent — a second seed for the same keys does not overwrite prior writes', () => {
      const formation = buildFormation();
      const item = buildItem(formation.uid);
      seedFormation(formation, [item]);

      putStoredFormation({ ...formation, sub_stage: 'activating' });
      putStoredItem({ ...item, status: 'done' });

      // Re-seeding with the original (stale) objects must not clobber the writes above.
      seedFormation(formation, [item]);

      expect(getStoredFormation(formation.uid)?.sub_stage).toBe('activating');
      expect(getStoredItem(item.uid)?.status).toBe('done');
    });
  });

  describe('getStoredItemsForFormation', () => {
    it('returns only items belonging to the given formation', () => {
      const formationA = buildFormation();
      const formationB = buildFormation();
      const itemA = buildItem(formationA.uid);
      const itemB = buildItem(formationB.uid);
      seedFormation(formationA, [itemA]);
      seedFormation(formationB, [itemB]);

      const result = getStoredItemsForFormation(formationA.uid);

      expect(result.map((item) => item.uid)).toEqual([itemA.uid]);
    });
  });

  describe('activity', () => {
    it('getActivityForItem filters to the given formation and item, most-recent first', () => {
      const formation = buildFormation();
      const item = buildItem(formation.uid);
      const otherItem = buildItem(formation.uid);
      const actor = { username: 'alex.rivera', name: 'Alex Rivera' };

      const first: FormationActivity = {
        uid: nextActivityUid(),
        formation_uid: formation.uid,
        formation_item_uid: item.uid,
        type: 'note_added',
        actor,
        message: 'first',
        metadata: null,
        created_at: '',
      };
      const second: FormationActivity = { ...first, uid: nextActivityUid(), message: 'second' };
      const forOtherItem: FormationActivity = { ...first, uid: nextActivityUid(), formation_item_uid: otherItem.uid, message: 'other item' };

      appendActivity(first);
      appendActivity(second);
      appendActivity(forOtherItem);

      const result = getActivityForItem(formation.uid, item.uid);

      expect(result.map((activity) => activity.message)).toEqual(['second', 'first']);
      expect(getActivityForFormation(formation.uid)).toHaveLength(3);
    });
  });

  describe('activity cap', () => {
    it('caps the retained activity list per formation instead of growing it unbounded', () => {
      const formation = buildFormation();
      const actor = { username: 'alex.rivera', name: 'Alex Rivera' };

      for (let i = 0; i < 210; i += 1) {
        appendActivity({
          uid: nextActivityUid(),
          formation_uid: formation.uid,
          formation_item_uid: null,
          type: 'note_added',
          actor,
          message: `entry ${i}`,
          metadata: null,
          created_at: '',
        });
      }

      const result = getActivityForFormation(formation.uid);
      expect(result).toHaveLength(200);
      // Most-recent-first — the cap must drop the oldest entries, not the newest.
      expect(result[0]?.message).toBe('entry 209');
    });
  });

  describe('formation capacity', () => {
    it('evicts the oldest formation (FIFO) once MAX_FORMATIONS_TRACKED is exceeded, cleaning up its items and activity too', () => {
      resetFormationStoreForTests();

      const oldest = buildFormation();
      const oldestItem = buildItem(oldest.uid);
      seedFormation(oldest, [oldestItem]);
      appendActivity({
        uid: nextActivityUid(),
        formation_uid: oldest.uid,
        formation_item_uid: null,
        type: 'note_added',
        actor: { username: 'alex.rivera', name: 'Alex Rivera' },
        message: 'first',
        metadata: null,
        created_at: '',
      });

      // One more than capacity — pushes the oldest formation out.
      for (let i = 0; i < MAX_FORMATIONS_TRACKED; i += 1) {
        seedFormation(buildFormation(), []);
      }

      expect(getStoredFormation(oldest.uid)).toBeUndefined();
      expect(getStoredItem(oldestItem.uid)).toBeUndefined();
      expect(getStoredItemsForFormation(oldest.uid)).toEqual([]);
      expect(getActivityForFormation(oldest.uid)).toEqual([]);

      resetFormationStoreForTests();
    });
  });

  describe('nextActivityUid', () => {
    it('never returns the same value twice', () => {
      const uids = new Set(Array.from({ length: 20 }, () => nextActivityUid()));
      expect(uids.size).toBe(20);
    });
  });
});
