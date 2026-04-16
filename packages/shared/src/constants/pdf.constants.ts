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
