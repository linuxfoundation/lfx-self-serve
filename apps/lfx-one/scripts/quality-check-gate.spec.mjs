// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Execute the workflow's actual Node payload, not a second implementation of the gate logic.
const workflow = readFileSync(new URL('../../../.github/workflows/quality-check.yml', import.meta.url), 'utf8');
const gate = workflow.slice(workflow.indexOf('\n  quality-checks:'));
const script = /node <<'NODE'\n([\s\S]*?)\n\s*NODE/.exec(gate)?.[1];
const dependencies = ['static-checks', 'build', 'unit-tests', 'frontend-tests'];

function run(results) {
  return spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, JOB_RESULTS: JSON.stringify(results) },
    encoding: 'utf8',
  });
}

function successfulJobs() {
  return Object.fromEntries(dependencies.map((name) => [name, { result: 'success' }]));
}

describe('aggregate Code Quality Checks gate', () => {
  it('always waits for all four prerequisite jobs', () => {
    expect(gate).toContain('if: always()');
    expect(gate).toContain(`needs: [${dependencies.join(', ')}]`);
    expect(script).toBeTruthy();
  });

  it('succeeds when every prerequisite succeeds', () => {
    const result = run(successfulJobs());
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(dependencies.flatMap((name) => ['failure', 'cancelled', 'skipped'].map((result) => [name, result])))('fails when %s reports %s', (name, result) => {
    const jobs = successfulJobs();
    jobs[name].result = result;
    expect(run(jobs).status).toBe(1);
  });
});

describe('Angular CI cache safety contract', () => {
  function job(name) {
    const match = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:|$)`).exec(workflow);
    expect(match, `Missing ${name} job`).toBeTruthy();
    return match[1];
  }

  function step(body, name) {
    const match = new RegExp(`      - name: ${name}\\n([\\s\\S]*?)(?=\\n      - name:|$)`).exec(body);
    expect(match, `Missing ${name} step`).toBeTruthy();
    return match[1];
  }

  it('enables the compiler cache in CI without disabling the existing local cache', () => {
    const angular = JSON.parse(readFileSync(new URL('../angular.json', import.meta.url), 'utf8'));
    expect(angular.cli.cache.environment).toBe('all');
    expect(angular.cli.cache.enabled).not.toBe(false);
  });

  it('caches production compiler state, never validation success', () => {
    const body = job('build');
    const namespace = step(body, 'Compute Angular cache namespace');
    expect(namespace).toContain('${RUNNER_OS}-${RUNNER_ARCH}-node${NODE_VERSION}-${CONFIG_HASH}-production-');
    expect(namespace).toContain('NODE_VERSION: ${{ steps.node.outputs.node-version }}');
    expect(namespace).toContain("hashFiles('yarn.lock'");
    expect(namespace).toContain("'apps/lfx-one/angular.json'");

    const restore = step(body, 'Restore Angular compiler cache');
    expect(restore).toMatch(/uses: actions\/cache\/restore@[a-f0-9]{40}/);
    expect(restore).toContain('path: apps/lfx-one/.angular/cache');
    expect(restore).toContain('key: ${{ steps.angular-cache-key.outputs.prefix }}${{ github.sha }}');
    expect(restore).toContain('restore-keys: ${{ steps.angular-cache-key.outputs.prefix }}');

    const validationStep = step(body, 'Build project');
    expect(validationStep).toContain('run: yarn build');
    expect(validationStep).not.toMatch(/^\s+if:/m);

    const save = step(body, 'Save Angular compiler cache');
    expect(save).toContain("success() && steps.angular-cache.outputs.cache-hit != 'true'");
    expect(save).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(save).not.toContain("github.event_name == 'merge_group'");
    expect(save).toContain('key: ${{ steps.angular-cache.outputs.cache-primary-key }}');
    expect(body).not.toMatch(/path:.*(?:dist|\.turbo|test-results)/);
  });

  it('pins restore and save to the same immutable release with version comments', () => {
    const body = job('build');
    const restore = /uses: actions\/cache\/restore@([a-f0-9]{40}) # (v\d+\.\d+\.\d+)/.exec(step(body, 'Restore Angular compiler cache'));
    const save = /uses: actions\/cache\/save@([a-f0-9]{40}) # (v\d+\.\d+\.\d+)/.exec(step(body, 'Save Angular compiler cache'));
    expect(restore).toBeTruthy();
    expect(save).toBeTruthy();
    expect(restore[1]).toBe(save[1]);
    expect(restore[2]).toBe(save[2]);
  });

  it('keeps every frontend shard unconditional and avoids unproven cache-transfer overhead', () => {
    const body = job('frontend-tests');
    expect(body).not.toContain('uses: actions/cache/');
    const validation = step(body, 'Run frontend shard');
    expect(validation).toContain('run: node scripts/run-app-test-shard.mjs');
    expect(validation).not.toMatch(/^\s+if:/m);
  });
});
