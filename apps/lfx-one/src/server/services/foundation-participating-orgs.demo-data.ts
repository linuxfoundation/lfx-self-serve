// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Demo data (#5707): the foundation-level LFX Insights / warehouse model does not exist yet, so the page is
// built against this deterministic, fictional data set. Every name and number below is invented. The service reads
// it through `FoundationParticipatingOrgsDataSource`, so a warehouse-backed source replaces this file without
// touching the controller, the routes or the client.

import type {
  FoundationParticipatingOrgsSourceCompany,
  FoundationParticipatingOrgsSourceFoundation,
  FoundationParticipatingOrgsSourceProject,
  FoundationParticipatingOrgsSourceProjectActivity,
  MembershipTierClass,
} from '@lfx-one/shared/interfaces';

const PROJECT_NAMES = [
  'Relay Protocol',
  'Helmsman',
  'Aurora',
  'Pyrite',
  'Courier',
  'Cobalt',
  'Stagehand',
  'Keystone',
  'Crosswind',
  'Flowkit',
  'Helmsight',
  'Helmguard',
];
const MATURITY = [
  'Graduated',
  'Graduated',
  'Graduated',
  'Graduated',
  'Incubating',
  'Incubating',
  'Incubating',
  'Incubating',
  'Sandbox',
  'Sandbox',
  'Sandbox',
  'Sandbox',
];

const COMPANY_NAMES = [
  'Northwind Labs',
  'Brightwater Inc',
  'Copperline Systems, Inc.',
  'Meridian Software Corporation',
  'Halden Analytics (formerly Orrin)',
  'Tanaka Systems Management',
  'Alder & Finch, Inc.',
  'Stackwell',
  'Lumen AI',
  'Quillmark',
  'Atlas Query',
  'Ironleaf s.r.o.',
  'Summit Cloud LLC',
  'Crimson Linux',
  'Zhenhua Tech',
  'Vector Virtual by Axiom',
  'Cascade Networks',
  'Dataflint',
  'Plotline Labs',
  'Linkward',
  'Clustermatic',
  'Fernhill Digital',
  'Oakridge Robotics',
  'Pinecrest Software',
  'Harbor & Vale',
  'Marlowe Data',
  'Tidewater Systems',
  'Redfern Cloud',
  'Skyline Mobile',
  'Bluepeak Engineering',
  'Granite Works',
  'Willow Analytics',
  'Ember Security',
  'Cinder Compute',
  'Nimbus Foundry',
  'Orchard Labs',
  'Sparrow Networks',
  'Juniper Devices',
  'Maple Logic',
  'Cedar Point Software',
  'Falcon Edge',
  'Lantern Health Tech',
  'Mosaic Platforms',
  'Prairie Systems',
  'Quarry Data',
  'Ridgeline Cloud',
  'Saffron Labs',
  'Talon Secure',
];

const TIERS: (MembershipTierClass | null)[] = [
  'Platinum',
  null,
  'Platinum',
  'Platinum',
  null,
  null,
  null,
  'Silver',
  'Platinum',
  'Silver',
  'Silver',
  'Gold',
  'Platinum',
  'Platinum',
  'Platinum',
  'Platinum',
  'Platinum',
  'Gold',
  'Gold',
  'Silver',
  'Silver',
];

/** Deterministic PRNG so the same foundation always shows the same numbers. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function change(rand: () => number): number | null {
  if (rand() < 0.08) return null;
  return Math.round((rand() * 1.6 - 0.45) * 100) / 100;
}

/** Builds the fictional foundation for a slug. The PRNG is seeded by the slug, so rebuilding is deterministic and cheap, and nothing is kept per slug. */
export function getDemoFoundation(slug: string): FoundationParticipatingOrgsSourceFoundation {
  const rand = mulberry32(hash(slug));
  const projects: FoundationParticipatingOrgsSourceProject[] = PROJECT_NAMES.map((name, index) => ({ slug: slugify(name), name, maturity: MATURITY[index] }));

  const companies: FoundationParticipatingOrgsSourceCompany[] = COMPANY_NAMES.map((name, index) => {
    const randomTier: MembershipTierClass | null = rand() < 0.2 ? 'Silver' : null;
    const tier = TIERS[index] === undefined ? randomTier : TIERS[index];
    // The first companies are the broadest contributors; later ones touch one or two projects.
    const spread = Math.max(1, Math.round(projects.length * Math.pow(rand(), 1.4) * (index < 16 ? 1 : 0.4)));
    // The largest company is active in every project, so the breakdown's "Other N projects" row shows up in the demo.
    const involved = index === 0 ? projects.length : spread;
    const picks = [...projects].sort(() => rand() - 0.5).slice(0, involved);
    const base = Math.round(Math.pow(1 - index / (COMPANY_NAMES.length + 4), 3.2) * 9000 + rand() * 400);
    const activity: FoundationParticipatingOrgsSourceProjectActivity[] = picks.map((project, order) => {
      const commits = Math.max(1, Math.round((base * Math.pow(0.7, order) * (0.6 + rand() * 0.8)) / 2));
      return {
        projectSlug: project.slug,
        commits,
        commitsChange: change(rand),
        contributors: Math.max(1, Math.round(commits / (18 + rand() * 40))),
        contributorsChange: change(rand),
      };
    });
    const summed = activity.reduce((total, item) => total + item.contributors, 0);
    const largest = Math.max(...activity.map((item) => item.contributors));
    return {
      key: `demo-${slugify(name)}`,
      name,
      tier,
      otherMemberships: tier && rand() < 0.25 ? ['Project member'] : [],
      // A person active in several projects counts once, so the total sits between the busiest project and the plain sum.
      foundationContributors: Math.min(summed, Math.max(largest, Math.round(summed * (0.7 + rand() * 0.25)))),
      foundationContributorsChange: change(rand),
      projects: activity,
    };
  });

  return { slug, name: `${titleCase(slug)} Foundation`, projects, companies };
}
