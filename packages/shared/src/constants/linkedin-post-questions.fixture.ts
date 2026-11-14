// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Derived from agent PR61 QA .guild-qa/linkedin-post/2026-10-19T{14-07-12-140Z,20-25-45-097Z}.
// Names and organisations aliased; LF-owned names and other envelope/research values retained.
// Document hashes are recomputed after aliasing; profile Markdown follows the alias.
// Original source document hashes are retained as provenance, not used for validation.

export const LINKEDIN_RECORDED_QUESTIONS =
  'LINKEDIN POST — QUESTIONS (linkedin-post-questions/v1)\n```json\n{\n  "contract": "linkedin-post-questions/v1",\n  "project": "Valkey",\n  "questions": [\n    {\n      "id": "tendency",\n      "question": "How would you describe your writing tendency on LinkedIn?",\n      "why": "The setup form skipped this, so a default is in place.",\n      "suggested_answer": "Direct and data-driven, with occasional humor",\n      "basis": "inferred"\n    },\n    {\n      "id": "admired-style",\n      "question": "What do posts you admire sound like?",\n      "why": "The setup form skipped this, so a default is in place.",\n      "suggested_answer": "Natural language, written as a conversation from person to person",\n      "basis": "inferred"\n    },\n    {\n      "id": "avoid",\n      "question": "What should your posts avoid?",\n      "why": "The setup form skipped this, so a default is in place.",\n      "suggested_answer": "Corporate jargon, buzzwords like \\"synergy\\", excessive self-promotion",\n      "basis": "inferred"\n    }\n  ]\n}\n```';

export const LINKEDIN_RECORDED_ANSWERS =
  'LINKEDIN POST — ANSWERS (linkedin-post-answers/v1)\n--- A tendency (accepted) ---\nANSWER: follows\nDirect and data-driven, with occasional humor\n--- END A tendency ---\n--- A admired-style (accepted) ---\nANSWER: follows\nNatural language, written as a conversation from person to person\n--- END A admired-style ---\n--- A avoid (accepted) ---\nANSWER: follows\nCorporate jargon, buzzwords like "synergy", excessive self-promotion\n--- END A avoid ---';

// Public text from the recorded blog run; reasoning text is NEVER copied.
export const LINKEDIN_RECORDED_PROGRESS = [
  {
    type: 'agent_notification_progress',
    created_at: '2026-10-19T14:08:12.518764+00:00',
    content: {
      type: 'application/guild-reasoning-progress',
      status: 'streaming',
      sequence: 1,
      stream_id: 'synthetic-progress-stream',
      text: 'PRIVATE_REASONING_MARKER',
    },
  },
  {
    type: 'agent_notification_progress',
    created_at: '2026-10-19T14:08:26.807247+00:00',
    content: {
      type: 'application/guild-reasoning-progress',
      status: 'done',
      sequence: 5,
      stream_id: 'synthetic-progress-stream',
      text: 'PRIVATE_REASONING_MARKER',
    },
  },
  {
    type: 'agent_notification_progress',
    created_at: '2026-10-19T14:08:26.971624+00:00',
    content: {
      type: 'text',
      data: "I'm reviewing your source and profile, then writing the three drafts.",
    },
  },
  {
    type: 'agent_notification_progress',
    created_at: '2026-10-19T14:08:40.231898+00:00',
    content: {
      type: 'text',
      data: "Option 3 used a banned phrase, so I'm rewording it and checking the drafts again.",
    },
  },
];
