// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_RUN_ACTIVITY_AGENT_TOOL_TABLES, MKTG_RUN_ACTIVITY_TOOLS } from '../../constants/mktg-run-activity.constants';
import { BRAND_KIT_QUESTIONS_CONTRACT_ID } from '../../constants/brand-kit.constants';
import { FOUNDATION_MESSAGE_QUESTIONS_CONTRACT_ID } from '../../constants/foundation-message.constants';
import { BOILERPLATES_QUESTIONS_CONTRACT_ID } from '../../constants/boilerplates.constants';
import { FAQ_QUESTIONS_CONTRACT_ID } from '../../constants/faq.constants';
import { LINKEDIN_QUESTIONS_CONTRACT } from '../../constants/linkedin-post.constants';
import { AEO_GEO_QUESTIONS_CONTRACT } from '../../constants/aeo-geo.constants';

/** Synthetic-only traces with the real registered tool names; no arguments, results, model text or identities. */
export function agentActivityReplay(agentKey: string): string[] {
  const table = MKTG_RUN_ACTIVITY_AGENT_TOOL_TABLES[agentKey];
  if (!table) return [];
  const contracts: Record<string, string> = {
    'brand-kit': BRAND_KIT_QUESTIONS_CONTRACT_ID,
    'foundation-message': FOUNDATION_MESSAGE_QUESTIONS_CONTRACT_ID,
    boilerplates: BOILERPLATES_QUESTIONS_CONTRACT_ID,
    faq: FAQ_QUESTIONS_CONTRACT_ID,
    'linkedin-post': LINKEDIN_QUESTIONS_CONTRACT,
    'aeo-geo': AEO_GEO_QUESTIONS_CONTRACT,
  };
  let second = 0;
  const at = () => new Date(Date.UTC(2026, 9, 29, 10, 0, second++)).toISOString();
  const events: string[] = [];
  const local = (name: string) =>
    events.push(JSON.stringify({ type: 'llm_done', created_at: at(), body: JSON.stringify({ type: 'tool_use', id: `tool-${second}`, name }) }));
  const platform = (name: string) => {
    const startedAt = at();
    const id = `task-${second}`;
    events.push(
      JSON.stringify({
        type: 'runtime_start',
        created_at: startedAt,
        task: { id, entity_type: 'EntTaskTool', tool_name: name, status: 'DONE', created_at: startedAt, updated_at: at() },
      })
    );
    events.push(JSON.stringify({ type: 'runtime_done', created_at: at(), task: { id, entity_type: 'EntTaskTool' } }));
  };
  platform(MKTG_RUN_ACTIVITY_TOOLS.fetch);
  for (const [name, definition] of Object.entries(table)) if (definition.kind === 'reading') local(name);
  platform(MKTG_RUN_ACTIVITY_TOOLS.lfxGetProject);
  platform(MKTG_RUN_ACTIVITY_TOOLS.webSearchJina);
  for (const [name, definition] of Object.entries(table)) if (definition.kind === 'lfx') local(name);
  for (const [name, definition] of Object.entries(table)) if (definition.kind === 'questions') local(name);
  if (contracts[agentKey])
    events.push(JSON.stringify({ type: 'agent_notification_message', created_at: at(), content: { type: 'text', data: contracts[agentKey] } }));
  events.push(JSON.stringify({ type: 'llm_start', created_at: at() }));
  for (const [name, definition] of Object.entries(table)) {
    if (definition.kind !== 'writing') continue;
    const count = name === 'record_member_actions' ? 40 : 1;
    for (let index = 0; index < count; index++) local(name);
  }
  const finalize = Object.entries(table).find(([, definition]) => definition.kind === 'checking');
  if (finalize) local(finalize[0]);
  events.push(JSON.stringify({ type: 'runtime_done', created_at: at(), task: { id: 'root', entity_type: 'EntTaskAgent', parent_task_id: null } }));
  return events;
}
