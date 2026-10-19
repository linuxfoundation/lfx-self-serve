// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The print documents of the Marketing OS asset views (Download PDF): the
// brand a print is set in, and the Messaging Framework's print as its
// template binds it.

import type {
  FoundationMessageAudienceRow,
  FoundationMessageAvoidRow,
  FoundationMessageGoalView,
  FoundationMessageIcpView,
  FoundationMessageMf,
  FoundationMessageMh,
  FoundationMessageNumberRow,
  FoundationMessagePillarView,
  FoundationMessageViewTab,
} from './foundation-message.interface';

/** Where a print's brand comes from: the project's stored Brand Kit, or the LF look when the project has none. */
export type MktgPrintBrandSource = 'kit' | 'lf';

/** A logo as a print draws it. */
export interface MktgPrintLogo {
  /** A data URL of the kit's SVG, or the app's own LF logo. */
  src: string;
  alt: string;
  /** CSS filter on the image: the reversed (white) rendering of a full-colour lockup, or '' to draw it as it is. */
  filter: string;
}

/** The brand a print is set in: colours, typeface and logo. */
export interface MktgPrintBrand {
  source: MktgPrintBrandSource;
  /** CSS colours: the primary dark, the one accent, a light tint of the dark, and the ink on the dark. */
  dark: string;
  accent: string;
  tint: string;
  onDark: string;
  /** The body text on the white pages: the dark when it reads on white, else the app's darkest gray. The dark stays the ground of the cover and the panels. */
  ink: string;
  /** The CSS font stack the print sets. */
  fontStack: string;
  /** The Google Fonts stylesheet of the typeface, null when the family is not there (or is the app's own). */
  fontUrl: string | null;
  /** The family Download PDF waits for before the dialog opens, null when there is nothing to load. */
  fontFamily: string | null;
  /** The logo on the dark cover, and on the white pages' running heads; null when there is no artwork to draw. */
  logoOnDark: MktgPrintLogo | null;
  logoOnLight: MktgPrintLogo | null;
}

/** One section of the framework print, as the cover lists it. */
export interface FoundationMessagePrintSection {
  id: FoundationMessageViewTab;
  /** `01`. */
  number: string;
  title: string;
}

/** One goal column as the print binds it: the view's column, with its segments as one line. */
export interface FoundationMessagePrintGoal extends FoundationMessageGoalView {
  /** `End users, Maintainers`: the segment names joined, '' when the column names none. */
  segmentLabel: string;
}

/** One segment as the print binds it: the view's segment, with its goals and channels as one line each. */
export interface FoundationMessagePrintIcp extends FoundationMessageIcpView {
  /** `Adoption, Contribution`: the goal titles joined, '' when the segment serves none. */
  goalLabel: string;
  /** `Docs · Slack`: the channels joined. */
  channelsLabel: string;
}

/** The Messaging Framework as its print lays it out: every string and colour the document binds. */
export interface FoundationMessagePrintView {
  brand: MktgPrintBrand;
  projectName: string;
  /** `Jupyter Foundation · a Linux Foundation project`, over the title and in the footers. */
  eyebrow: string;
  title: string;
  /** `Version 3`, '' when the page shows no version. */
  versionLabel: string;
  /** `Jupyter Foundation Messaging Framework`. */
  runningHead: string;
  sections: FoundationMessagePrintSection[];
  mf: FoundationMessageMf;
  mh: FoundationMessageMh;
  goals: FoundationMessagePrintGoal[];
  icps: FoundationMessagePrintIcp[];
  pillars: FoundationMessagePillarView[];
  avoidRows: FoundationMessageAvoidRow[];
  numbers: FoundationMessageNumberRow[];
  audiences: FoundationMessageAudienceRow[];
}
