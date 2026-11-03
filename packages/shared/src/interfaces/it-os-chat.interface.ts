// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ItOsActionResult, ItOsChatAction } from './it-os-dns.interface';

// Shared chat types for the IT OS GitHub, email forwarding and mailing list agents (#4257).

export type ItOsChangeValue = string | string[] | boolean | undefined;

/** The fields a proposed change carries. Keys depend on the kind of change. */
export type ItOsChangePayload = Record<string, ItOsChangeValue>;

/** Which changes apply immediately and which go to LF IT for approval. */
export interface ItOsChangePolicy {
  describe: (payload: ItOsChangePayload) => string;
  needsApproval: (payload: ItOsChangePayload) => boolean;
  reason: (payload: ItOsChangePayload) => string;
}

export interface ItOsChange {
  key: string;
  payload: ItOsChangePayload;
  on: boolean;
}

/** A set of proposed changes the user confirms or cancels. */
export interface ItOsChangePlan {
  changes: ItOsChange[];
  /** 'open', 'done' or 'cancelled'. */
  state: string;
  results?: ItOsActionResult[];
}

/** One input in a form the agent shows inside the chat. */
export interface ItOsChatField {
  id: string;
  /** 'checkbox', 'text' or 'textarea'. */
  kind: string;
  label: string;
  hint?: string;
  placeholder?: string;
  /** Sample value the user can fill in with one click. */
  sample?: string;
  /** Show under the field before it, for "who" inputs that belong to a checkbox. */
  indent?: boolean;
}

export interface ItOsChatForm {
  fields: ItOsChatField[];
  values: Record<string, string | boolean>;
}

/** One message in an IT OS agent chat. Bot HTML is built from escaped text and sanitized by Angular on render. */
export interface ItOsAgentMessage {
  fromUser: boolean;
  text?: string;
  html?: string;
  typing?: boolean;
  /** Progress steps shown one by one while the agent works. */
  steps?: string[];
  shown?: number;
  plan?: ItOsChangePlan;
  actions?: ItOsChatAction[];
  /** Set once one of the message's action buttons was used. */
  used?: boolean;
  form?: ItOsChatForm;
  /** Runs after the plan's changes are confirmed, with the ones the user left unticked. */
  after?: (skipped: ItOsChange[]) => void;
}

/** A sample situation the demo can switch to. */
export interface ItOsScenario {
  id: string;
  label: string;
}
