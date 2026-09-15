// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Storage-layer constants for the SHARED Marketing OS agent-artifact
// persistence path (dec-brand-kit-storage-v2, generalized to every agent).
// One bucket, one key layout, one set of shape gates — the per-agent table
// below is the only place an agent differs.

import type { MktgArtifactKey, MktgArtifactSpec } from '../interfaces/mktg-artifact.interface';

/**
 * Shape gate for an LFX project uid wherever it becomes ONE PATH SEGMENT:
 * the storage partition of `{prefix}/{project}/…` AND the upstream
 * `/projects/{uid}` lookup the persisting endpoints run before it. Both
 * interpolate the uid unencoded, so a value carrying `/`, `.`, `?` or `#`
 * would reshape a key or an authenticated upstream URL — this pattern is what
 * makes "one safe segment" true instead of assumed (the
 * `document.controller.ts` UID_PATTERN precedent).
 *
 * The partition is always the SERVER-RESOLVED uid that owns the document —
 * never an agent envelope's own slug (which is derived from a free-text
 * project name and identifies nothing in LFX). Deliberately wide because LFX
 * uids are opaque upstream identifiers, but still exactly one safe segment: no
 * separators, no dots, so no traversal.
 */
export const MKTG_ARTIFACT_PARTITION_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Lowercase hex SHA-256 pattern — the content-addressed half of every artifact key. */
export const MKTG_ARTIFACT_SHA256_REGEX = /^[0-9a-f]{64}$/;

/** Hard per-object size cap (bytes) per the LFX object-store design (20 MB). */
export const MKTG_ARTIFACT_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Object key suffix — every Marketing OS artifact is a Markdown document. */
export const MKTG_ARTIFACT_KEY_SUFFIX = '.md';

/** Content type stored objects are written with. */
export const MKTG_ARTIFACT_CONTENT_TYPE = 'text/markdown; charset=utf-8';

/**
 * Draft version reported for an object whose metadata carries none —
 * everything persisted before metadata was written, and anything unparseable.
 * The DOCUMENTED default is 1, which is also the only safe value on the write
 * path: an unlabelled object counts as the oldest possible draft, never a
 * newer one.
 */
export const MKTG_ARTIFACT_DEFAULT_DRAFT_VERSION = 1;

/**
 * Per-agent artifact specs — the ONLY thing that differs between agents'
 * persistence. Everything else (entitlement-checked partition, size gate,
 * content-addressed keys, the shared `marketing-os-artifacts` bucket, object
 * metadata, the strictly-newer-draft metadata refresh, degrade-to-null, the
 * list+get read path and its ordering) is implemented once in
 * `MktgArtifactService`.
 *
 * Adding the remaining agents is an entry here plus BFF wiring — a `pitch-deck`
 * entry would read exactly like the three below.
 */
export const MKTG_ARTIFACT_SPECS: Record<MktgArtifactKey, MktgArtifactSpec> = {
  'brand-kit': {
    agentKey: 'brand-kit',
    keyPrefix: 'brand-kit',
    maxDocumentBytes: MKTG_ARTIFACT_MAX_DOCUMENT_BYTES,
    logNamespace: 'brand_kit',
  },
  'foundation-message': {
    agentKey: 'foundation-message',
    keyPrefix: 'foundation-message',
    maxDocumentBytes: MKTG_ARTIFACT_MAX_DOCUMENT_BYTES,
    logNamespace: 'foundation_message',
  },
  // Registered ahead of its BFF endpoints: the ICP agent's self-serve page is
  // in flight and its persistence is now a wiring job, not an implementation.
  icp: {
    agentKey: 'icp',
    keyPrefix: 'icp',
    maxDocumentBytes: MKTG_ARTIFACT_MAX_DOCUMENT_BYTES,
    logNamespace: 'icp',
  },
};
