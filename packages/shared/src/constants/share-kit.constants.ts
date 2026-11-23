// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Platforms a share kit writes posts for, in tab order. */
export const SHARE_KIT_PLATFORMS = ['linkedin', 'x', 'bluesky'] as const;

/** Event slugs are lowercase letters, digits and single hyphens — also the content folder name. */
export const SHARE_KIT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Graphics may be served from the app's public folder under this path. */
export const SHARE_KIT_LOCAL_ASSET_PREFIX = '/share-kits/';
