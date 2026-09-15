// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Spec-driven key helpers for the shared Marketing OS agent-artifact storage
// layout: `{spec.keyPrefix}/{project uid}/{content_sha256}.md` in the one
// `marketing-os-artifacts` bucket. Pure and platform-neutral — the SHA-256
// recompute is deliberately NOT here (hashing is environment-specific; the
// server recomputes with node:crypto and compares before calling in).

import { MKTG_ARTIFACT_KEY_SUFFIX, MKTG_ARTIFACT_PARTITION_REGEX, MKTG_ARTIFACT_SHA256_REGEX } from '../constants/mktg-artifact.constants';
import type { MktgArtifactSpec } from '../interfaces/mktg-artifact.interface';

/**
 * The partition prefix an agent's documents for one project live under —
 * `{spec.keyPrefix}/{projectPartition}/`. The write path's keys start with it
 * and the read path lists exactly it, so a persisted document can never be
 * invisible to the project that owns it.
 *
 * `projectPartition` is the SERVER-RESOLVED LFX project uid that owns the
 * document — never an envelope's own `project` slug, which comes from the
 * free-text project name the user typed and therefore identifies no LFX
 * project.
 *
 * Throws on an unvalidated partition: this builds a storage path, so a caller
 * that has not shape-gated its input must never get a silently odd key back.
 */
export function buildMktgArtifactPartitionPrefix(spec: MktgArtifactSpec, projectPartition: string): string {
  if (!MKTG_ARTIFACT_PARTITION_REGEX.test(projectPartition)) {
    throw new Error('buildMktgArtifactPartitionPrefix requires an already-validated project partition');
  }
  return `${spec.keyPrefix}/${projectPartition}/`;
}

/**
 * Derive the content-addressed object key from validated fields only.
 *
 * Throws when either input is unvalidated — the same gate the Brand Kit key
 * builder has always carried, now shared: keys are derived from a
 * server-resolved partition and a server-recomputed sha, never from anything
 * a client named.
 */
export function buildMktgArtifactObjectKey(spec: MktgArtifactSpec, projectPartition: string, contentSha256: string): string {
  if (!MKTG_ARTIFACT_SHA256_REGEX.test(contentSha256)) {
    throw new Error('buildMktgArtifactObjectKey requires an already-validated content_sha256');
  }
  return `${buildMktgArtifactPartitionPrefix(spec, projectPartition)}${contentSha256}${MKTG_ARTIFACT_KEY_SUFFIX}`;
}

/**
 * The sha256 half of a content-addressed key `{prefix}{sha}.md`, or null when
 * the key is not one — which is how the read path ignores anything else that
 * shares the partition, whatever its date.
 */
export function extractMktgArtifactKeySha(key: string, partitionPrefix: string): string | null {
  if (!key.startsWith(partitionPrefix) || !key.endsWith(MKTG_ARTIFACT_KEY_SUFFIX)) {
    return null;
  }
  const sha = key.slice(partitionPrefix.length, -MKTG_ARTIFACT_KEY_SUFFIX.length);
  return MKTG_ARTIFACT_SHA256_REGEX.test(sha) ? sha : null;
}
