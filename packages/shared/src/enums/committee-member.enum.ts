// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Committee member role types
 */
export enum CommitteeMemberRole {
  CHAIR = 'Chair',
  COUNSEL = 'Counsel',
  DEVELOPER_SEAT = 'Developer Seat',
  TAC_TOC_REPRESENTATIVE = 'TAC/TOC Representative',
  DIRECTOR = 'Director',
  LEAD = 'Lead',
  NONE = 'None',
  SECRETARY = 'Secretary',
  TREASURER = 'Treasurer',
  VICE_CHAIR = 'Vice Chair',
  LF_STAFF = 'LF Staff',
}

/**
 * Committee member appointment sources
 */
export enum CommitteeMemberAppointedBy {
  COMMUNITY = 'Community',
  MEMBERSHIP_ENTITLEMENT = 'Membership Entitlement',
  VOTE_OF_END_USER_MEMBER_CLASS = 'Vote of End User Member Class',
  VOTE_OF_TSC_COMMITTEE = 'Vote of TSC Committee',
  VOTE_OF_TAC_COMMITTEE = 'Vote of TAC Committee',
  VOTE_OF_ACADEMIC_MEMBER_CLASS = 'Vote of Academic Member Class',
  VOTE_OF_LAB_MEMBER_CLASS = 'Vote of Lab Member Class',
  VOTE_OF_MARKETING_COMMITTEE = 'Vote of Marketing Committee',
  VOTE_OF_GOVERNING_BOARD = 'Vote of Governing Board',
  VOTE_OF_GENERAL_MEMBER_CLASS = 'Vote of General Member Class',
  VOTE_OF_END_USER_COMMITTEE = 'Vote of End User Committee',
  VOTE_OF_TOC_COMMITTEE = 'Vote of TOC Committee',
  VOTE_OF_GOLD_MEMBER_CLASS = 'Vote of Gold Member Class',
  VOTE_OF_SILVER_MEMBER_CLASS = 'Vote of Silver Member Class',
  VOTE_OF_STRATEGIC_MEMBERSHIP_CLASS = 'Vote of Strategic Membership Class',
  NONE = 'None',
}

/**
 * Committee member status types
 */
export enum CommitteeMemberStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

/**
 * Committee member voting status types
 */
export enum CommitteeMemberVotingStatus {
  ALTERNATE_VOTING_REP = 'Alternate Voting Rep',
  OBSERVER = 'Observer',
  VOTING_REP = 'Voting Rep',
  EMERITUS = 'Emeritus',
  NONE = 'None',
}
