// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  FORMATION_PIPELINE_COPY,
  FORMATION_PIPELINE_PROSPECT_LABEL,
  FORMATION_PIPELINE_STAGE_LABELS,
  FORMATION_PIPELINE_STAT_CAPTIONS,
  FORMATION_QUEUE_COPY,
} from './formation-pipeline.constants';

/** #5619 Part A: the formation team sees "Draft" for a v2 `Prospect`, and the Archived card no longer claims a project did not launch. */
describe('formation pipeline copy (#5619)', () => {
  it('captions the Archived card neutrally', () => {
    expect(FORMATION_PIPELINE_STAT_CAPTIONS.archived).toBe('No longer active');
    expect(Object.values(FORMATION_PIPELINE_STAT_CAPTIONS).join(' ')).not.toMatch(/did not launch/i);
  });

  it('names the Prospect stage "Draft" everywhere the formation team reads copy', () => {
    expect(FORMATION_PIPELINE_PROSPECT_LABEL).toBe('Draft');
    expect(FORMATION_PIPELINE_STAGE_LABELS.prospect).toBe('Draft');
    const queueCopy = [FORMATION_QUEUE_COPY.emptySubtitle, FORMATION_QUEUE_COPY.allSubtitle, FORMATION_QUEUE_COPY.foundationSubtitle('Example Foundation')];
    for (const text of [...queueCopy, ...Object.values(FORMATION_PIPELINE_COPY)]) {
      expect(text).not.toMatch(/prospect/i);
    }
    expect(FORMATION_QUEUE_COPY.emptySubtitle).toBe('Formations between Draft and Active will appear here.');
    expect(FORMATION_QUEUE_COPY.allSubtitle).toBe('Every foundation, project, and child project between Draft and Active.');
    expect(FORMATION_QUEUE_COPY.foundationSubtitle('Example Foundation')).toBe("Example Foundation's formations between Draft and Active.");
  });
});
