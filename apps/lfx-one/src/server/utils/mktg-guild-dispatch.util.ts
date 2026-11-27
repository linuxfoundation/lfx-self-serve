// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgGuildSessionDispatch } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const dispatches = new WeakMap<Request, MktgGuildSessionDispatch>();

/** GuildService records how far this request's session creation got; a start reads it to tell a failure before dispatch from an uncertain one. */
export function noteGuildSessionDispatch(req: Request, state: MktgGuildSessionDispatch): void {
  dispatches.set(req, state);
}

export function guildSessionDispatch(req: Request): MktgGuildSessionDispatch {
  return dispatches.get(req) ?? 'none';
}
