// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignMetaAudienceTargetingBlock,
  MetaDetailedTargeting,
  MetaDeviceOsBlockInput,
  MetaDeviceOsDraft,
  MetaDeviceOsOption,
  MetaObjective,
  MetaPlacement,
} from '../interfaces/campaign.interface';
import { compactMetaDetailedTargeting, metaDeviceOsRefusal } from './campaign-meta-detailed-targeting.utils';

/**
 * The Implement tab's Meta devices and operating systems (#5904 row 6): `metaConfig.targeting.devicePlatforms` and
 * `userOs`. What the tab keeps, sends and holds Create for. The rules themselves are the create route's
 * (`metaDeviceOsRefusal`), so the tab and the server cannot disagree.
 */

/** No device or OS ticked: Meta's default, every device and system. */
export function emptyMetaDeviceOsDraft(): MetaDeviceOsDraft {
  return { devicePlatforms: [], userOs: [] };
}

/** A copy whose lists are its own, so the parent's draft never holds a live view of the tab's signal. */
export function copyMetaDeviceOsDraft(draft: MetaDeviceOsDraft): MetaDeviceOsDraft {
  return { devicePlatforms: [...draft.devicePlatforms], userOs: [...draft.userOs] };
}

/** `values` with `value` ticked or unticked, in the order of `options` (the checkboxes' order), so a draft reads the same however it was ticked. */
export function metaDeviceOsWithValue(values: readonly string[], value: string, on: boolean, options: readonly MetaDeviceOsOption[]): string[] {
  const order = options.map((o) => o.value);
  const chosen = new Set(values);
  if (on) chosen.add(value);
  else chosen.delete(value);
  const known = order.filter((v) => chosen.has(v));
  return [...known, ...[...chosen].filter((v) => !order.includes(v))];
}

/** The strings of a saved list, or `null` when the value is not a list of strings. */
function stringsFromDraft(raw: unknown): string[] | null {
  return Array.isArray(raw) && raw.every((v) => typeof v === 'string') ? [...new Set(raw)] : null;
}

/**
 * The devices and systems a saved draft restores, or `undefined` for a draft saved before row 6 (neither key present).
 * The draft is persisted JSON: a list of strings comes back as saved, even when the rules now refuse it (desktop only
 * beside Audience Network), so its error still holds Create; anything else comes back empty.
 */
export function metaDeviceOsFromDraft(devicePlatforms: unknown, userOs: unknown): MetaDeviceOsDraft | undefined {
  if (devicePlatforms === undefined && userOs === undefined) return undefined;
  return { devicePlatforms: stringsFromDraft(devicePlatforms) ?? [], userOs: stringsFromDraft(userOs) ?? [] };
}

/**
 * The devices and systems a Meta create sends: each list only on its flag's explicit yes, and only when something is
 * ticked. Compacted as the server forwards them. A ticked list without a yes holds Create instead.
 */
export function metaDeviceOsForCreate(
  draft: MetaDeviceOsDraft,
  deviceEnabled: boolean | null,
  osEnabled: boolean | null
): Pick<MetaDetailedTargeting, 'devicePlatforms' | 'userOs'> {
  return (
    compactMetaDetailedTargeting({
      ...(deviceEnabled === true ? { devicePlatforms: draft.devicePlatforms } : {}),
      ...(osEnabled === true ? { userOs: draft.userOs } : {}),
    }) ?? {}
  );
}

/** `draft` with each list this deployment answered no to cleared: the Clear past an `unsupported` block, whose control is hidden. */
export function metaDeviceOsSendable(draft: MetaDeviceOsDraft, deviceEnabled: boolean | null, osEnabled: boolean | null): MetaDeviceOsDraft {
  return {
    devicePlatforms: deviceEnabled === false ? [] : [...draft.devicePlatforms],
    userOs: osEnabled === false ? [] : [...draft.userOs],
  };
}

/**
 * Why Create is held for devices or systems the draft holds but the request cannot carry, or `null`: the audience
 * block's states. Held rather than dropped, since a dropped "mobile only" spends the budget on every device.
 * `unsupported` (a flag answered no) offers Clear; while an answer is out or failed, only waiting or Retry.
 */
export function metaDeviceOsBlock(input: MetaDeviceOsBlockInput): CampaignMetaAudienceTargetingBlock | null {
  const held = [input.draft.devicePlatforms.length > 0 ? input.deviceEnabled : true, input.draft.userOs.length > 0 ? input.osEnabled : true].filter(
    (answer) => answer !== true
  );
  if (held.length === 0) return null;
  if (held.includes(false)) {
    return {
      kind: 'unsupported',
      message:
        'The Meta devices or operating systems on this brief are not available on this deployment, so they cannot be sent. Clear them to create the campaign.',
    };
  }
  if (input.createCapabilityRead === 'pending') {
    return {
      kind: 'pending',
      message: 'Checking whether you can send the Meta devices or operating systems. Create waits for the answer so they are not dropped.',
    };
  }
  if (!input.briefId) return { kind: 'unsaved', message: "The Meta devices or operating systems can't be checked until this brief is saved. Save the brief." };
  return {
    kind: 'failed',
    message: 'Could not confirm that you can send the Meta devices or operating systems, so Create waits rather than dropping them. Retry the check.',
  };
}

/** What the Clear past an `unsupported` {@link metaDeviceOsBlock} clears, as its button says it: only the lists answered no. */
export function metaDeviceOsClearLabel(draft: MetaDeviceOsDraft, deviceEnabled: boolean | null, osEnabled: boolean | null): string {
  const devices = draft.devicePlatforms.length > 0 && deviceEnabled === false;
  const os = draft.userOs.length > 0 && osEnabled === false;
  if (devices && os) return 'Clear the devices and operating systems';
  return devices ? 'Clear the devices' : 'Clear the operating systems';
}

/**
 * Why the devices and systems as ticked cannot be sent with the rest of the form, or `null`: the create route's own
 * rule, given the objective and the FULL placement state (Audience Network decides whether desktop only is allowed).
 */
export function metaDeviceOsError(draft: MetaDeviceOsDraft, objective: MetaObjective, placements: MetaPlacement): string | null {
  const targeting = {
    ...(draft.devicePlatforms.length > 0 ? { devicePlatforms: draft.devicePlatforms } : {}),
    ...(draft.userOs.length > 0 ? { userOs: draft.userOs } : {}),
  };
  return metaDeviceOsRefusal(targeting, objective, placements)?.message ?? null;
}
