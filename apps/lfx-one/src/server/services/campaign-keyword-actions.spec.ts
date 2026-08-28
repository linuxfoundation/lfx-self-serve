// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { KeywordActionRequest } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { appliedResults, failedResults, groupByCampaign, toBulkResponse, toUpstreamActions } from './campaign-keyword-actions';

const kw = (campaignId: string, criterionId: string, adGroupId = 'ag-1'): KeywordActionRequest => ({
  campaignId,
  adGroupId,
  criterionId,
  action: 'pause',
});

describe('groupByCampaign', () => {
  it('groups keywords by their campaign', () => {
    const groups = groupByCampaign([kw('555', '1'), kw('666', '2'), kw('555', '3')]);

    expect(groups).toHaveLength(2);
    expect(groups[0].platformCampaignId).toBe('555');
    expect(groups[0].keywords.map((k) => k.criterionId)).toEqual(['1', '3']);
    expect(groups[1].keywords.map((k) => k.criterionId)).toEqual(['2']);
  });

  // Campaign ids are numeric strings, and a plain object would iterate them in ascending
  // numeric order regardless of insertion — so a Map is required, not incidental. Asserted with
  // a descending pair, which is the case an object key ordering would silently reorder.
  it('preserves the order campaigns were first seen', () => {
    const groups = groupByCampaign([kw('999', '1'), kw('111', '2')]);

    expect(groups.map((g) => g.platformCampaignId)).toEqual(['999', '111']);
  });

  it('returns nothing for an empty request', () => {
    expect(groupByCampaign([])).toEqual([]);
  });
});

describe('toUpstreamActions', () => {
  // The vocabularies differ in case, and getting it wrong is a 400 from upstream rather than a
  // type error here.
  it.each([
    ['pause', 'PAUSE'],
    ['remove', 'REMOVE'],
  ] as const)('maps the %s action to %s', (uiAction, upstream) => {
    const actions = toUpstreamActions([kw('555', '1')], uiAction);

    expect(actions).toEqual([{ ad_group_id: 'ag-1', criterion_id: '1', action: upstream }]);
  });

  it('carries each keyword through with its own ids', () => {
    const actions = toUpstreamActions([kw('555', '1', 'ag-1'), kw('555', '2', 'ag-2')], 'pause');

    // Distinct ad group ids: a mapper that reused the first keyword's would pass a
    // single-element check.
    expect(actions.map((a) => a.ad_group_id)).toEqual(['ag-1', 'ag-2']);
    expect(actions.map((a) => a.criterion_id)).toEqual(['1', '2']);
  });
});

describe('failedResults', () => {
  // THE ATOMICITY CONTRACT. Upstream applies the batch in full or not at all, so a failure means
  // NONE of the campaign's keywords changed. Marking only one failed would leave a caller
  // believing the rest were paused and hunting for which.
  it('marks every keyword in the campaign failed, not just one', () => {
    const [group] = groupByCampaign([kw('555', '1'), kw('555', '2'), kw('555', '3')]);

    const results = failedResults(group, 'pause', 'upstream said no');

    expect(results).toHaveLength(3);
    expect(results.every((r) => !r.success)).toBe(true);
    expect(results.map((r) => r.message)).toEqual(['upstream said no', 'upstream said no', 'upstream said no']);
  });

  it('names each keyword by its own criterion id', () => {
    const [group] = groupByCampaign([kw('555', '1'), kw('555', '2')]);

    expect(failedResults(group, 'pause', 'x').map((r) => r.keyword)).toEqual(['Criterion 1', 'Criterion 2']);
  });
});

describe('appliedResults', () => {
  it('reports every keyword in the campaign as applied', () => {
    const [group] = groupByCampaign([kw('555', '1'), kw('555', '2')]);

    const results = appliedResults(group, 'remove');

    expect(results.every((r) => r.success)).toBe(true);
    expect(results[0].message).toContain('removed');
    expect(results[0].action).toBe('remove');
  });

  it('uses the paused wording for a pause', () => {
    const [group] = groupByCampaign([kw('555', '1')]);

    expect(appliedResults(group, 'pause')[0].message).toContain('paused');
  });
});

describe('toBulkResponse', () => {
  // A partially-applied batch is a FAILURE at this level. Each campaign is all-or-nothing, but
  // the caller asked for one thing and got part of it, so `success` must not be true.
  it('reports a mixed outcome as not successful', () => {
    const [ok] = groupByCampaign([kw('555', '1')]);
    const [bad] = groupByCampaign([kw('666', '2')]);

    const response = toBulkResponse([...appliedResults(ok, 'pause'), ...failedResults(bad, 'pause', 'nope')]);

    expect(response.success).toBe(false);
    expect(response.total).toBe(2);
    expect(response.succeeded).toBe(1);
    expect(response.failed).toBe(1);
  });

  it('reports a fully applied batch as successful', () => {
    const [group] = groupByCampaign([kw('555', '1'), kw('555', '2')]);

    const response = toBulkResponse(appliedResults(group, 'pause'));

    expect(response.success).toBe(true);
    expect(response.succeeded).toBe(2);
    expect(response.failed).toBe(0);
  });

  // An empty result set is not a success. Nothing was applied, and answering `success: true`
  // would tell a caller their keywords were paused when no request was ever made.
  it('does not report an empty result set as successful', () => {
    expect(toBulkResponse([])).toMatchObject({ success: false, total: 0, succeeded: 0, failed: 0 });
  });
});
