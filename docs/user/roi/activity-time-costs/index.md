---
title: Activity time costs
description: The estimated hours the ROI model assigns to each type of contribution activity, with low, medium, and high scenarios and the reasoning behind each estimate.
audience: [all]
product_area: Dashboards
tags: [roi, time costs, hours, fte, activity, estimates]
last_updated: 2026-10-16
intercom_collection: Dashboards
---

The ROI model converts contribution activity counts into full-time-equivalent (FTE) effort using an estimated number of hours for each activity type:

```text
FTE = Σ (activity count × hours required) / 2080 × overhead multiplier
```

See [Contribution labor](../contribution-labor/) for how FTE becomes a dollar cost.

## Scenarios

Each activity type has three estimates: **low**, **medium**, and **high**. The ROI page uses **medium**. Low assumes a small or simple instance of the activity, medium a typical one, and high a substantial or complex one. High is skewed upward because effort distributions are long-tailed.

## Methodology

- The hours are the **marginal focused effort for one event**, not elapsed time. A chat message takes seconds. Opening a pull request takes hours.
- Effort ladder: authoring > reviewing > triage and commenting > administrative events > passive signals.
- Labels that describe the same action in different tools (for example, an issue opened in different trackers) share the same values. Where an activity appears as both code and community activity, the estimate is the same for both.
- Commit-trailer labels (`reviewed-commit`, `tested-commit`, and so on) count the credited work only. Authoring a commit and opening the pull request that carries it are separate events, so some work can be counted once per event.
- Estimates are in hours. Values smaller than 0.1 mean "a few minutes or less".
- **Time costs are estimates of the effort required for each activity, not tracked time.** Actual time varies with context and individual efficiency. The goal is a reasonable average that is accurate in aggregate.

## Estimates and rationale

Activity time cost estimates (measured in hours per unit of activity) are shown for the low, medium, and high scenarios. The last column describes the activity and the reasoning for the medium estimate.

### Commits

| Activity             | Low  | Medium | High | What it counts and why the medium estimate                                                                                                                           |
| -------------------- | ---- | ------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approved-commit`    | 0.1  | 0.25   | 0.5  | Contributor approved a commit via an Approved-by style trailer. Review already done elsewhere; trailer records the sign-off.                                         |
| `authored-commit`    | 0.5  | 1.5    | 4.0  | Git commit authored by the contributor (commit author field). Reading context, writing the change, local testing; high end for non-trivial feature work.             |
| `co-authored-commit` | 0.25 | 0.75   | 2.0  | Contributor credited via a Co-authored-by trailer on a commit. Shared authorship, so roughly half the effort of a sole author.                                       |
| `committed-commit`   | 0.1  | 0.25   | 0.5  | Contributor is the git committer (applied/merged the commit) but not necessarily the author. Maintainer applying or rebasing someone else's work; mostly mechanical. |
| `influenced-commit`  | 0.1  | 0.25   | 0.5  | Contributor credited with an Influenced-by trailer (ideas informed the commit). Low confidence. Design input or discussion, not implementation.                      |
| `informed-commit`    | 0.05 | 0.15   | 0.25 | Contributor credited with an Informed-by trailer (provided information). Low confidence. Brief information sharing.                                                  |
| `reported-commit`    | 0.25 | 0.5    | 1.0  | Contributor credited with a Reported-by trailer (found the bug the commit fixes). Low confidence. Diagnosing and writing up a bug report.                            |
| `resolved-commit`    | 0.25 | 0.5    | 1.5  | Contributor credited with a Resolved-by style trailer. Low confidence. Work to resolve the underlying issue, distinct from authoring the patch.                      |
| `reviewed-commit`    | 0.25 | 0.5    | 1.0  | Contributor credited with a Reviewed-by trailer. Reading and evaluating a typical diff.                                                                              |
| `signed-off-commit`  | 0.02 | 0.05   | 0.1  | Contributor added a Signed-off-by (DCO) trailer. Attestation only; no incremental engineering effort beyond authoring or review.                                     |
| `tested-commit`      | 0.25 | 0.5    | 1.5  | Contributor credited with a Tested-by trailer. Building and running the change; high end for hardware or integration testing.                                        |

### Pull / merge requests

| Activity                                 | Low  | Medium | High | What it counts and why the medium estimate                                                                                                                                                     |
| ---------------------------------------- | ---- | ------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merge_request-closed`                   | 0.05 | 0.15   | 0.3  | A pull/merge request was closed without merging (or closed by this contributor). Triage decision and a short explanatory comment.                                                              |
| `merge_request-comment`                  | 0.1  | 0.25   | 0.5  | A comment was posted on a pull/merge request conversation. Reading the thread and writing a short reply.                                                                                       |
| `merge_request-merged`                   | 0.1  | 0.25   | 0.5  | A pull/merge request was merged by this contributor. One unit per merge. Final check and merge action.                                                                                         |
| `merge_request-opened`                   | 1.0  | 3.0    | 8.0  | A pull request (GitHub) or merge request (GitLab) was opened. One unit per PR/MR. Branch prep, description, responding to CI, iterating; excludes commit authoring counted separately.         |
| `merge_request-review-approved`          | 0.25 | 0.5    | 1.0  | A merge request review was approved (GitLab). Reviewing the change before approving.                                                                                                           |
| `merge_request-review-changes-requested` | 0.25 | 0.5    | 1.0  | A merge request review requested changes (GitLab). Reviewing the change and articulating requested edits.                                                                                      |
| `merge_request-review-requested`         | 0.02 | 0.05   | 0.1  | Review was requested from someone on a pull/merge request. Credited to the requester or reviewee depending on source. Administrative action; the review itself is counted as a separate event. |
| `pull_request-closed`                    | 0.05 | 0.15   | 0.3  | A pull/merge request was closed without merging (or closed by this contributor). Triage decision and a short explanatory comment.                                                              |
| `pull_request-comment`                   | 0.1  | 0.25   | 0.5  | A comment was posted on a pull/merge request conversation. Reading the thread and writing a short reply.                                                                                       |
| `pull_request-merged`                    | 0.1  | 0.25   | 0.5  | A pull/merge request was merged by this contributor. One unit per merge. Final check and merge action.                                                                                         |
| `pull_request-opened`                    | 1.0  | 3.0    | 8.0  | A pull request (GitHub) or merge request (GitLab) was opened. One unit per PR/MR. Branch prep, description, responding to CI, iterating; excludes commit authoring counted separately.         |
| `pull_request-review-requested`          | 0.02 | 0.05   | 0.1  | Review was requested from someone on a pull/merge request. Credited to the requester or reviewee depending on source. Administrative action; the review itself is counted as a separate event. |
| `pull_request-review-thread-comment`     | 0.05 | 0.15   | 0.35 | An inline comment within a pull request review thread. Short line-level review comment.                                                                                                        |
| `pull_request-reviewed`                  | 0.25 | 0.5    | 1.5  | A pull request review was submitted (GitHub review event). One unit per review. Reading the diff and writing feedback; high end for large PRs.                                                 |

### Gerrit changesets / patchsets

| Activity                    | Low | Medium | High | What it counts and why the medium estimate                                                                                                            |
| --------------------------- | --- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changeset-abandoned`       | 0.1 | 0.25   | 0.5  | A Gerrit change was merged or abandoned. Closing action plus brief note.                                                                              |
| `changeset-created`         | 1.0 | 3.0    | 8.0  | A Gerrit change (changeset) was created. Equivalent to opening a pull request.                                                                        |
| `changeset-merged`          | 0.1 | 0.25   | 0.5  | A Gerrit change was merged or abandoned. Closing action plus brief note.                                                                              |
| `changeset_comment-created` | 0.1 | 0.25   | 0.5  | A comment was posted on a Gerrit change. Reading and replying.                                                                                        |
| `patchset-created`          | 0.5 | 1.5    | 4.0  | A new patchset (revision) was uploaded to a Gerrit change. Addressing review feedback and re-uploading; less than a new change.                       |
| `patchset_approval-created` | 0.1 | 0.25   | 0.5  | A review vote/approval (e.g. Code-Review +2) was added to a Gerrit patchset. Vote after review; review reading effort is partly captured in comments. |
| `patchset_comment-created`  | 0.1 | 0.25   | 0.5  | An inline comment was posted on a Gerrit patchset. Short review comment.                                                                              |

### Issues

| Activity                 | Low  | Medium | High | What it counts and why the medium estimate                                                                                           |
| ------------------------ | ---- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `issue-assigned`         | 0.02 | 0.05   | 0.15 | An issue, pull request or merge request was assigned to someone. Administrative triage; the work itself is counted via other events. |
| `issue-attachment-added` | 0.05 | 0.15   | 0.3  | An attachment was added to an issue. Preparing and uploading a file or log.                                                          |
| `issue-closed`           | 0.05 | 0.15   | 0.3  | An issue was closed. Verification and close action.                                                                                  |
| `issue-comment`          | 0.1  | 0.25   | 0.5  | A comment was added to or edited on an issue. Reading the thread and replying.                                                       |
| `issue-comment-created`  | 0.1  | 0.25   | 0.5  | A comment was added to or edited on an issue. Reading the thread and replying.                                                       |
| `issue-comment-updated`  | 0.1  | 0.25   | 0.5  | A comment was added to or edited on an issue. Reading the thread and replying.                                                       |
| `issue-created`          | 0.25 | 0.5    | 1.5  | An issue was opened (GitHub/GitLab/Jira). One unit per issue. Reproducing, searching for duplicates, writing the report.             |
| `issue-updated`          | 0.1  | 0.25   | 0.5  | An issue was edited (title, body, labels, etc.). Brief edit or triage.                                                               |
| `issues-closed`          | 0.05 | 0.15   | 0.3  | An issue was closed. Verification and close action.                                                                                  |
| `issues-opened`          | 0.25 | 0.5    | 1.5  | An issue was opened (GitHub/GitLab/Jira). One unit per issue. Reproducing, searching for duplicates, writing the report.             |
| `merge_request-assigned` | 0.02 | 0.05   | 0.15 | An issue, pull request or merge request was assigned to someone. Administrative triage; the work itself is counted via other events. |
| `pull_request-assigned`  | 0.02 | 0.05   | 0.15 | An issue, pull request or merge request was assigned to someone. Administrative triage; the work itself is counted via other events. |

### Discussion and chat

| Activity             | Low  | Medium | High | What it counts and why the medium estimate                                                                         |
| -------------------- | ---- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `answer`             | 0.1  | 0.25   | 0.75 | An answer was posted to a question. Researching and writing an answer.                                             |
| `comment`            | 0.05 | 0.15   | 0.35 | A generic comment (source-agnostic, e.g. forum or wiki). Short reply.                                              |
| `comment-created`    | 0.05 | 0.15   | 0.35 | A generic comment (source-agnostic, e.g. forum or wiki). Short reply.                                              |
| `create_topic`       | 0.1  | 0.25   | 0.75 | A forum topic was created (e.g. Discourse). Writing the opening post.                                              |
| `discussion-comment` | 0.1  | 0.25   | 0.5  | A comment was posted in a discussion thread. Reading and replying.                                                 |
| `discussion-started` | 0.25 | 0.5    | 1.5  | A discussion thread was started (GitHub Discussions, forum). Composing a topic.                                    |
| `hashtag`            | 0.02 | 0.05   | 0.1  | A hashtag was used in a post. Source unclear. Negligible effort.                                                   |
| `mention`            | 0.02 | 0.05   | 0.1  | The contributor mentioned (@) another user or was mentioned. Direction unclear. Negligible effort.                 |
| `message`            | 0.02 | 0.05   | 0.15 | A chat message was sent (Slack/Discord/forum). Counts are high-volume. Seconds to a couple of minutes per message. |
| `message_in_topic`   | 0.02 | 0.05   | 0.15 | A chat message was sent (Slack/Discord/forum). Counts are high-volume. Seconds to a couple of minutes per message. |
| `post`               | 0.1  | 0.25   | 0.75 | A forum or social post was published. Writing a short post.                                                        |
| `question`           | 0.1  | 0.25   | 0.5  | A question was posted (Q&A forum such as Stack Overflow style tooling). Formulating a question.                    |
| `reaction`           | 0.01 | 0.02   | 0.05 | An emoji reaction was added to content. A few seconds.                                                             |

### Documentation and content

| Activity             | Low  | Medium | High | What it counts and why the medium estimate                                                                                   |
| -------------------- | ---- | ------ | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| `attachment-created` | 0.1  | 0.25   | 0.5  | A file attachment was created (likely on wiki/Confluence or tracker). Source system unclear. Preparing and uploading a file. |
| `blogpost-created`   | 1.5  | 4.0    | 10.0 | A blog post was created. Drafting, editing, publishing.                                                                      |
| `blogpost-updated`   | 0.25 | 0.5    | 1.5  | A blog post was edited. Revision pass.                                                                                       |
| `page-created`       | 0.5  | 1.5    | 4.0  | A wiki/Confluence page was created. Writing a documentation page.                                                            |
| `page-updated`       | 0.1  | 0.25   | 0.75 | A wiki/Confluence page was edited. Small to moderate edit.                                                                   |

### Meetings and events

| Activity                 | Low  | Medium | High | What it counts and why the medium estimate                                                                                                               |
| ------------------------ | ---- | ------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `added-to-committee`     | 0.25 | 0.5    | 1.0  | Was added to a committee or working group. Onboarding and acceptance.                                                                                    |
| `attended-event`         | 4.0  | 8.0    | 16.0 | Attended an in-person or virtual event (conference). One unit per event-day or registration. A working day at medium; multi-day or travel-heavy at high. |
| `attended-meeting`       | 0.5  | 1.0    | 1.5  | Attended an LFX meeting (Zoom). One unit per meeting attended. Typical project meeting is 30 to 90 minutes.                                              |
| `channel_joined`         | 0.02 | 0.05   | 0.1  | Joined a chat channel (Slack) or guild (Discord). A click.                                                                                               |
| `invited-meeting`        | 0.02 | 0.05   | 0.1  | Was invited to an LFX meeting; no attendance implied. Receiving and accepting an invite.                                                                 |
| `joined_guild`           | 0.02 | 0.05   | 0.1  | Joined a chat channel (Slack) or guild (Discord). A click.                                                                                               |
| `registered-event`       | 0.05 | 0.1    | 0.25 | Registered for an event as an attendee. Filling a registration form.                                                                                     |
| `registered_as_attendee` | 0.05 | 0.1    | 0.25 | Registered for an event as an attendee. Filling a registration form.                                                                                     |
| `registered_as_speaker`  | 2.0  | 5.0    | 12.0 | Registered as a speaker (submitted talk or confirmed speaking). Proposal and slide preparation.                                                          |
| `removed-from-committee` | 0.05 | 0.1    | 0.25 | Was removed from a committee or working group. Administrative offboarding.                                                                               |

### Training and certification

| Activity                       | Low  | Medium | High | What it counts and why the medium estimate                                                                                                                                            |
| ------------------------------ | ---- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attempted-course`             | 1.0  | 3.0    | 8.0  | Attempted a Training course (LF Training/edX). Learner time, not contributor time. Typical course module length; ambiguous whether this should count as contribution. Low confidence. |
| `attempted-exam`               | 1.0  | 1.5    | 3.0  | Attempted a certification exam. Exam seating time (1.5h to 3h typical). Low confidence.                                                                                               |
| `certificate_issued`           | 0.02 | 0.05   | 0.1  | A certificate or certification was issued. Passive outcome event.                                                                                                                     |
| `enrolled-certification`       | 0.05 | 0.1    | 0.25 | Enrolled in a certification, e-learning, instructor-led course or training. Registration step only.                                                                                   |
| `enrolled-training`            | 0.05 | 0.1    | 0.25 | Enrolled in a certification, e-learning, instructor-led course or training. Registration step only.                                                                                   |
| `enrolled_into_certification`  | 0.05 | 0.1    | 0.25 | Enrolled in a certification, e-learning, instructor-led course or training. Registration step only.                                                                                   |
| `enrolled_into_e-learning`     | 0.05 | 0.1    | 0.25 | Enrolled in a certification, e-learning, instructor-led course or training. Registration step only.                                                                                   |
| `enrolled_into_instructor-led` | 0.05 | 0.1    | 0.25 | Enrolled in a certification, e-learning, instructor-led course or training. Registration step only.                                                                                   |
| `issued-certification`         | 0.02 | 0.05   | 0.1  | A certificate or certification was issued. Passive outcome event.                                                                                                                     |

## Known limitations

- There is no scaling by project size, language, or change size. A one-line typo fix and a kernel subsystem rewrite cost the same.
- Counts include bot and automated activity unless it is filtered out upstream, which inflates high-volume, low-effort activity (messages, reactions, merges). Bot members are excluded from the ROI activity counts.
- Overlapping events double count related work (for example, an authored commit plus the pull request opened for the same change).
- Training labels (`attempted-course`, `attempted-exam`) measure learner time, which may not belong in a contribution ROI.
- Event attendance excludes travel and preparation.
- Several activity labels have unclear semantics. These are marked as low confidence above.

## Lowest-confidence estimates

Starting with the highest potential impact on totals:

1. `attempted-course` and `attempted-exam`: learner time versus contributor time.
2. `attended-event`: one unit per event, per day, or per registration?
3. `message` and `message_in_topic`: high volume, so small per-event changes matter.
4. `reported-commit`, `resolved-commit`, `influenced-commit`, and `informed-commit`: unusual commit trailers.
5. `mention`, `hashtag`, and `attachment-created`: source system and direction unclear.

## Related reading

- [Contribution labor](../contribution-labor/)
- [Data overview](../data-overview/)
