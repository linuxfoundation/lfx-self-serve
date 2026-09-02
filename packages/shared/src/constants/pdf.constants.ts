// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PDFTemplateDetails } from '../interfaces/events.interface';

export const DEFAULT_TEMPLATE: PDFTemplateDetails = {
  link: 'https://www.linuxfoundation.org/',
  address: `2810 N Church St\nPMB 57274\nWilmington, Delaware 19802-4447 US\nPhone/Fax: +1 415 723 9709`,
  name: 'The Linux Foundation',
  desc: 'The Linux Foundation (www.linuxfoundation.org) is a nonprofit consortium dedicated to fostering the growth of the Linux operating system. The Linux Foundation promotes, protects and standardizes Linux by providing unified resources and services. It is supported by its members — the leading IT companies such as IBM, Intel, Hewlett Packard, etc. (http://www.linuxfoundation.org/en/Members).',
  onBehalf: 'On behalf of The Linux Foundation, we are glad you were able to join us.',
  logo: 'image2.png',
  signature: 'image1.png',
  signatureText: `Jim Zemlin\nExecutive Director`,
};

/** Logo width used by the letterhead when a template doesn't specify its own. */
export const DEFAULT_LOGO_WIDTH = 145;

/**
 * Full LF Open Source, LLC identity mandated by legal for attendance certificates on events
 * held in China that were imported through the CSV backfill flow. Overrides the
 * project/default template's link, name, description, on-behalf line, and logo. Address and
 * signature deliberately stay with the base template — legal scoped the mandate to the entity
 * named and linked in the letter, not to the signing officer or mailing address. See GH-1695
 * (logo only) and GH-2039 (full identity).
 *
 * The 13.6:1 wordmark is illegible at DEFAULT_LOGO_WIDTH (~10pt tall); 240pt matches the
 * Linux Foundation icon's visual weight and clears the address block at x=408.
 */
export const LF_OPEN_SOURCE_OVERRIDE: Required<Pick<PDFTemplateDetails, 'link' | 'name' | 'desc' | 'onBehalf' | 'logo' | 'logoWidth'>> = {
  link: 'https://lfopensource.cn/',
  name: 'LF Open Source, LLC',
  desc: 'LF Open Source, LLC is a nonprofit consortium dedicated to fostering the growth of the Linux operating system. LF Open Source, LLC promotes, protects and standardizes Linux by providing unified resources and services. It is supported by its members — the leading IT companies such as IBM, Intel, Hewlett Packard, etc.',
  onBehalf: 'On behalf of LF Open Source, LLC, we are glad you were able to join us.',
  logo: 'lfopensource-logo.png',
  logoWidth: 240,
};

/**
 * Country that, paired with a backfill EVENT_SOURCE (see isBackfillEventSource), triggers the
 * LF Open Source override. EVENT_SOURCE stands in for REGISTRATION_SOURCE, which the Platinum
 * view does not expose — see GH-1695.
 */
export const LF_OPEN_SOURCE_OVERRIDE_MATCH = {
  EVENT_COUNTRY: 'China',
} as const;

export const PROJECT_TEMPLATES: Record<string, PDFTemplateDetails> = {
  a0941000002wBz4AAE: {
    link: 'https://www.cncf.io/',
    address: `2810 N Church St\nPMB 57274\nWilmington, Delaware 19802-4447 US\nPhone/Fax: +1 415 723 9709`,
    name: 'Cloud Native Computing Foundation (CNCF)',
    desc: "CNCF (https://www.cncf.io/) builds sustainable ecosystems and fosters a community around a constellation of high-quality projects that orchestrate containers as part of a microservices architecture. CNCF serves as the vendor-neutral home for many of the fastest-growing projects on GitHub, including Kubernetes, Prometheus and Envoy, fostering collaboration between the industry's top developers, end users, and vendors.",
    onBehalf: 'On behalf of CNCF, we are glad you were able to join us.',
    logo: 'cncf-logo.png',
    signature: 'cncf-signature.png',
    signatureText: `Priyanka Sharma\nExecutive Director`,
  },
};
