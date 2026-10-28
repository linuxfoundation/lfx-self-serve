// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_SESSION_TURN_STARTED } from './mktg-run.constants';

// Public 12-event wrapper order from the hand-test refusal; every ID and body text is synthetic.
// No runtime_done is exposed. All task statuses are current DONE, including historical events.
export const MKTG_ONE_OFF_RECORDED_REFUSAL_PAYLOADS = [
  {
    type: 'trigger_message',
    task: {
      id: 'synthetic-root',
      entity_type: 'EntTaskAgent',
      status: 'DONE',
      parent_task_id: null,
    },
    content: {
      data: 'SYNTHETIC event 0 text',
      type: 'text',
    },
  },
  {
    type: 'agent_notification_progress',
    task: {
      id: 'synthetic-tool-1',
      entity_type: 'EntTaskTool',
      status: 'DONE',
      parent_task: {
        id: 'synthetic-root',
      },
    },
    content: {
      data: 'SYNTHETIC event 1 text',
      type: 'text',
    },
  },
  {
    type: 'agent_notification_message',
    task: {
      id: 'synthetic-root',
      entity_type: 'EntTaskAgent',
      status: 'DONE',
      parent_task_id: null,
    },
    content: {
      sequence: 2,
      status: 'continued',
      stream_id: 'synthetic-stream',
      text: 'SYNTHETIC event 2 text',
      type: 'application/guild-response-stream',
    },
  },
  {
    type: 'agent_notification_progress',
    task: {
      id: 'synthetic-root',
      entity_type: 'EntTaskAgent',
      status: 'DONE',
      parent_task_id: null,
    },
    content: {
      sequence: 3,
      status: 'done',
      stream_id: 'synthetic-stream',
      text: 'SYNTHETIC event 3 text',
      type: 'application/guild-reasoning-progress',
    },
  },
  {
    type: 'agent_notification_progress',
    task: {
      id: 'synthetic-tool-4',
      entity_type: 'EntTaskTool',
      status: 'DONE',
      parent_task: {
        id: 'synthetic-root',
      },
    },
    content: {
      data: 'SYNTHETIC event 4 text',
      type: 'text',
    },
  },
  {
    type: 'agent_notification_progress',
    task: {
      id: 'synthetic-tool-5',
      entity_type: 'EntTaskTool',
      status: 'DONE',
      parent_task: {
        id: 'synthetic-root',
      },
    },
    content: {
      data: 'SYNTHETIC event 5 text',
      type: 'text',
    },
  },
  {
    type: 'agent_notification_progress',
    task: {
      id: 'synthetic-tool-6',
      entity_type: 'EntTaskTool',
      status: 'DONE',
      parent_task: {
        id: 'synthetic-root',
      },
    },
    content: {
      data: 'SYNTHETIC event 6 text',
      type: 'text',
    },
  },
  {
    type: 'agent_notification_progress',
    task: {
      id: 'synthetic-tool-7',
      entity_type: 'EntTaskTool',
      status: 'DONE',
      parent_task: {
        id: 'synthetic-root',
      },
    },
    content: {
      data: 'SYNTHETIC event 7 text',
      type: 'text',
    },
  },
  {
    type: 'agent_notification_message',
    task: {
      id: 'synthetic-root',
      entity_type: 'EntTaskAgent',
      status: 'DONE',
      parent_task_id: null,
    },
    content: {
      is_delta: true,
      sequence: 8,
      status: 'aborted',
      stream_id: 'synthetic-stream',
      text: 'SYNTHETIC event 8 text',
      type: 'application/guild-response-stream',
    },
  },
  {
    type: 'agent_notification_progress',
    task: {
      id: 'synthetic-root',
      entity_type: 'EntTaskAgent',
      status: 'DONE',
      parent_task_id: null,
    },
    content: {
      sequence: 9,
      status: 'done',
      stream_id: 'synthetic-stream',
      text: 'SYNTHETIC event 9 text',
      type: 'application/guild-reasoning-progress',
    },
  },
  {
    type: 'agent_notification_progress',
    task: {
      id: 'synthetic-tool-10',
      entity_type: 'EntTaskTool',
      status: 'DONE',
      parent_task: {
        id: 'synthetic-root',
      },
    },
    content: {
      data: 'SYNTHETIC event 10 text',
      type: 'text',
    },
  },
  {
    type: 'agent_notification_message',
    task: {
      id: 'synthetic-root',
      entity_type: 'EntTaskAgent',
      status: 'DONE',
      parent_task_id: null,
    },
    content: {
      data: 'SYNTHETIC final refusal: the request form could not be read.',
      type: 'text',
    },
  },
].map((event) => JSON.stringify(event));

/** Exact service boundary: Guild replaces user/trigger bodies with a content-free turn marker. */
export const MKTG_ONE_OFF_NORMALIZED_REFUSAL_PAYLOADS = MKTG_ONE_OFF_RECORDED_REFUSAL_PAYLOADS.map((payload) => {
  const event = JSON.parse(payload) as Record<string, unknown>;
  return event['type'] === 'trigger_message' || event['type'] === 'user_message' ? JSON.stringify({ type: MKTG_SESSION_TURN_STARTED }) : payload;
});
