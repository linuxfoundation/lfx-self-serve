// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BOILERPLATES_FIELD_KEYS, BOILERPLATES_FRAMEWORK_ANSWER_KEY, BOILERPLATES_MAX_FRAMEWORK_CHARS } from './boilerplates.constants';
import { BRAND_KIT_FIELD_KEYS, BRAND_KIT_FRAMEWORK_ANSWER_KEY, BRAND_KIT_MAX_FRAMEWORK_CHARS } from './brand-kit.constants';
import { FAQ_FRAMEWORK_ANSWER_KEY, FAQ_MAX_FRAMEWORK_CHARS } from './faq.constants';
import { FOUNDATION_MESSAGE_ANSWER_MAX_CHARS, FOUNDATION_MESSAGE_MAX_OTHER_LINKS, FOUNDATION_MESSAGE_SOURCE_URL_KEYS } from './foundation-message.constants';
import { ICP_GAP_FILL_KEYS } from './icp.constants';

/** BFF intake limits count submitted UTF-16 code units, before trimming. */
export const MKTG_INTAKE_PROJECT_NAME_MAX_CHARS = 200;
export const MKTG_INTAKE_URL_MAX_CHARS = 2048;
export const MKTG_INTAKE_ANSWER_MAX_CHARS = FOUNDATION_MESSAGE_ANSWER_MAX_CHARS;

/** ICP receives whole sibling documents, not short answers; match the framework attachment budget. */
export const ICP_INTAKE_DOCUMENT_MAX_CHARS = 400_000;

/**
 * Every accepted generate-request answer key has an explicit budget. Document
 * attachments retain their larger limits; URL lists allow the existing maximum
 * number of full-length URLs separated by CRLF (including a final separator).
 */
export const MKTG_INTAKE_ANSWER_LIMITS = {
  icp: {
    project_name: MKTG_INTAKE_PROJECT_NAME_MAX_CHARS,
    github_url: MKTG_INTAKE_URL_MAX_CHARS,
    ...Object.fromEntries(ICP_GAP_FILL_KEYS.map((key) => [key, MKTG_INTAKE_ANSWER_MAX_CHARS])),
    brand_kit_markdown: ICP_INTAKE_DOCUMENT_MAX_CHARS,
    message_foundation_markdown: ICP_INTAKE_DOCUMENT_MAX_CHARS,
  },
  'brand-kit': {
    [BRAND_KIT_FIELD_KEYS.projectName]: MKTG_INTAKE_PROJECT_NAME_MAX_CHARS,
    [BRAND_KIT_FIELD_KEYS.websiteUrl]: MKTG_INTAKE_URL_MAX_CHARS,
    [BRAND_KIT_FIELD_KEYS.brandPageUrl]: MKTG_INTAKE_URL_MAX_CHARS,
    [BRAND_KIT_FIELD_KEYS.notes]: MKTG_INTAKE_ANSWER_MAX_CHARS,
    [BRAND_KIT_FRAMEWORK_ANSWER_KEY]: BRAND_KIT_MAX_FRAMEWORK_CHARS,
  },
  'foundation-setup': {
    project_name: MKTG_INTAKE_PROJECT_NAME_MAX_CHARS,
    description: MKTG_INTAKE_ANSWER_MAX_CHARS,
    ...Object.fromEntries(FOUNDATION_MESSAGE_SOURCE_URL_KEYS.map((key) => [key, MKTG_INTAKE_URL_MAX_CHARS])),
    links: FOUNDATION_MESSAGE_MAX_OTHER_LINKS * (MKTG_INTAKE_URL_MAX_CHARS + 2),
  },
  boilerplates: {
    [BOILERPLATES_FIELD_KEYS.projectName]: MKTG_INTAKE_PROJECT_NAME_MAX_CHARS,
    [BOILERPLATES_FIELD_KEYS.websiteUrl]: MKTG_INTAKE_URL_MAX_CHARS,
    [BOILERPLATES_FIELD_KEYS.notes]: MKTG_INTAKE_ANSWER_MAX_CHARS,
    [BOILERPLATES_FRAMEWORK_ANSWER_KEY]: BOILERPLATES_MAX_FRAMEWORK_CHARS,
  },
  faq: {
    project_name: MKTG_INTAKE_PROJECT_NAME_MAX_CHARS,
    description: MKTG_INTAKE_ANSWER_MAX_CHARS,
    website_url: MKTG_INTAKE_URL_MAX_CHARS,
    github_url: MKTG_INTAKE_URL_MAX_CHARS,
    notes: MKTG_INTAKE_ANSWER_MAX_CHARS,
    [FAQ_FRAMEWORK_ANSWER_KEY]: FAQ_MAX_FRAMEWORK_CHARS,
  },
} satisfies Record<string, Readonly<Record<string, number>>>;
