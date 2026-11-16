// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Synthetic replay of hand-test item 3's supplied tool order; real tool names, no output or customer data. */
export function member360ActivityReplay(): string[] {
  const at = (second: number) => new Date(Date.UTC(2026, 9, 29, 10, 0, second)).toISOString();
  const platform = (name: string, id: string, second: number, content: Record<string, unknown> = {}) => [
    JSON.stringify({
      type: 'runtime_start',
      created_at: at(second),
      task: { id, entity_type: 'EntTaskTool', tool_name: name, status: 'DONE', created_at: at(second), updated_at: at(second + 1) },
      content,
    }),
    JSON.stringify({ type: 'runtime_done', created_at: at(second + 1), task: { id, entity_type: 'EntTaskTool' } }),
  ];
  const local = (name: string, second: number) =>
    JSON.stringify({
      type: 'llm_done',
      created_at: at(second),
      body: JSON.stringify({ type: 'tool_use', id: `synthetic-${second}`, name, input: { private: 'never-render-this-argument' } }),
    });
  return [
    ...platform('experimental_fetch_fetch', 'source', 0, { url: 'https://synthetic.example' }),
    ...platform('lfx_mcp_search_members', 'roster', 2),
    ...platform('lfx_mcp_get_membership_key_contacts', 'contacts', 4),
    JSON.stringify({ type: 'llm_start', created_at: at(6) }),
    local('score_member_360', 7),
    ...Array.from({ length: 40 }, (_, index) => local('record_member_actions', 8 + index)),
    local('finalize_member_360', 48),
    JSON.stringify({ type: 'runtime_done', created_at: at(49), task: { id: 'root', entity_type: 'EntTaskAgent', parent_task_id: null } }),
  ];
}
