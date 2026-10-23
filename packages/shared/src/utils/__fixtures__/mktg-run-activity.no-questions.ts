// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_RUN_ACTIVITY_TOOLS } from '../../constants/mktg-run-activity.constants';

/** Synthetic Guild shapes matching the trimmed session fixture; never a fabricated feed step. */
export function noQuestionsActivityPayloads(stage: 'research' | 'between-rounds' | 'writing' | 'checked', brandKit = false): string[] {
  const task = {
    entity_type: 'EntTaskTool',
    id: 'synthetic-search-task',
    tool_name: MKTG_RUN_ACTIVITY_TOOLS.webSearch,
    status: 'DONE',
    created_at: '2026-10-20T10:00:02Z',
    updated_at: '2026-10-20T10:00:03Z',
  };
  const localTool = (name: string, createdAt: string): Record<string, unknown> => ({
    type: 'llm_done',
    created_at: createdAt,
    body: `data: ${JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: `synthetic-${name}`, name, input: {} } })}`,
  });
  const events: Record<string, unknown>[] = [
    { type: 'llm_start', created_at: '2026-10-20T10:00:00Z' },
    {
      type: 'runtime_start',
      created_at: task.created_at,
      task: { ...task, status: 'RUNNING', updated_at: task.created_at },
      content: { query: 'Synthetic project public sources' },
    },
    { type: 'runtime_done', created_at: task.updated_at, task, content: { note: 'tool output omitted' } },
  ];
  if (brandKit) {
    events.push(localTool(MKTG_RUN_ACTIVITY_TOOLS.inspectLogos, '2026-10-20T10:00:04Z'));
  }
  if (stage !== 'research') {
    events.push({ type: 'llm_start', created_at: '2026-10-20T10:00:05Z' });
    events.push(localTool(MKTG_RUN_ACTIVITY_TOOLS.fetch, '2026-10-20T10:00:06Z'));
  }
  if (stage === 'writing' || stage === 'checked') {
    const second = {
      ...task,
      id: 'synthetic-page-task',
      tool_name: MKTG_RUN_ACTIVITY_TOOLS.fetch,
      created_at: '2026-10-20T10:00:07Z',
      updated_at: '2026-10-20T10:00:08Z',
    };
    events.push({
      type: 'runtime_start',
      created_at: second.created_at,
      task: { ...second, status: 'RUNNING' },
      content: { url: 'https://synthetic.example/about' },
    });
    events.push({ type: 'runtime_done', created_at: second.updated_at, task: second });
    events.push({ type: 'llm_start', created_at: '2026-10-20T10:00:09Z' });
  }
  if (stage === 'checked') {
    events.push(localTool(brandKit ? MKTG_RUN_ACTIVITY_TOOLS.finalizeBrandKit : MKTG_RUN_ACTIVITY_TOOLS.finalize, '2026-10-20T10:00:12Z'));
    events.push({ type: 'llm_start', created_at: '2026-10-20T10:00:13Z' });
  }
  return events.map((event) => JSON.stringify(event));
}
