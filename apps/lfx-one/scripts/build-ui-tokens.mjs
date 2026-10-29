#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/*
 * ui:tokens: regenerates src/styles/ui-tokens.css from scripts/ui-tokens/tokens.json, the LFX UI Library's
 * canonical token file. Run it after updating tokens.json; the build-ui-tokens spec fails if the committed
 * CSS drifts from the JSON.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildUiTokensCss } from './lib/build-ui-tokens.mjs';

const TOKENS_PATH = resolve(import.meta.dirname, 'ui-tokens/tokens.json');
const CSS_PATH = resolve(import.meta.dirname, '../src/styles/ui-tokens.css');

writeFileSync(CSS_PATH, buildUiTokensCss(JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))));
// The format check covers src/**/*.css, so the committed file must be Prettier output.
execFileSync('yarn', ['prettier', '--write', CSS_PATH], { stdio: 'inherit' });
