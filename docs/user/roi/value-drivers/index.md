---
title: Value drivers
description: How to read the Value drivers chart on the ROI Metrics page — what each bar means, the five categories, how far to trust it — plus the 19 measurements (proxies and controls) behind it.
audience: [all]
product_area: Dashboards
display_order: 7
tags: [roi, value drivers, decomposition, proxies, controls, company lens, categories, interpretation]
last_updated: 2026-11-05
intercom_collection: Dashboards
---

The ROI model estimates **how much** value your company gets from a project. The **Value drivers** chart asks the next question: **where does that value come from?** It compares your portfolio with a typical company-project pair and shows which kinds of value make your return higher or lower than typical.

This page is for anyone reading the chart. Its last section lists the measurements the chart is built from. For the method behind it, see [Value driver decomposition](../value-driver-decomposition/).

## Where to find it

The **Projects** panel on the ROI Metrics page has a **Value drivers** tab. It covers your whole portfolio, so it ignores the project picker. It follows the estimation method you choose in **Model assumptions**.

The tab appears only for companies with at least 5 projects that also pass the [ROI display gate](../interpreting-results/#which-companies-are-shown). Others see an empty state, because the figures are too noisy to read for small portfolios.

## What a bar means

Each row is one **value driver category**. The bar shows how much that category pushes your portfolio's return **above or below** the typical pair.

- The middle line, labelled **Typical**, is the typical company-project pair: the average across all pairs LFX models.
- A bar to the right (green) means that category contributes **more return** to your portfolio than it does for a typical pair. A bar to the left (amber) means it contributes **less**.
- A bar of +14% means 14% more return than typical from that category. A bar of −5% means 5% less.
- A bar at 0 means your portfolio is typical for that category. It does **not** mean the category provides no value.
- The bars do **not** add up to your total return. They show differences from typical, not a share of the total.

### A worked example

Suppose the chart shows these bars for a company:

| Category            | Bar | How to read it                                                                                                   |
| ------------------- | --- | ---------------------------------------------------------------------------------------------------------------- |
| Direct cost savings | +9% | Compared with a typical pair, this portfolio earns about 9% more return from activity that looks like shared R&D |
| Risk mitigation     | +3% | A little more than typical from patch upstreaming, reviewing, and mature projects                                |
| Strategic           | −4% | A little less than typical from talent flow and governance engagement                                            |

This does not say the company gets "9% of its return" from cost savings. It says that cost-savings-type activity moves this portfolio's return 9% **above** where a typical pair sits.

## The five categories

Each category groups one or more **value drivers**: reasons a company may contribute to open source. LFX tracks 17 drivers in all. Eight of them can be measured from public LFX data, and those make up the chart. The other nine have no usable measurement, so they are not in it.

| Category            | Drivers that are measured                                    | What it is about                                                                        |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Direct cost savings | Shared R&D                                                   | Developing non-core infrastructure with peers to split the cost                         |
| Revenue boosters    | Developer productivity, Standardization leadership           | Speeding up your own products and shaping the industry standard                         |
| Risk mitigation     | Technical debt reduction, Project longevity                  | Upstreaming work instead of keeping a private fork, and keeping the software maintained |
| Strategic           | Talent acquisition and development, Competitive intelligence | Hiring and upskilling through open source, and seeing where a technology is heading     |
| Prosocial           | Ecosystem goodwill                                           | The social capital that makes future collaboration easier                               |

A category's bar adds up only its **measured** drivers. Drivers with no measurement, such as supply chain security or license displacement, are not in any bar. That is a limit of the data, not a finding that those reasons do not matter.

### How each driver is measured

A driver cannot be observed directly, so each one is represented by **proxies**: signals in public LFX data that should go up when that kind of value goes up. For example, talent acquisition is represented by people who contributed to the project before joining your company, and by certificates held by your staff. Every proxy, with what it measures, its source and its direction, is listed in [The measurements behind the chart](#the-measurements-behind-the-chart).

The chart also accounts for some context that is not a motive, such as whether the project is a foundation and what share of the project's funding you provide. That context is held out of the bars so it does not get credited to a driver.

## How far to trust it

- **Association, not cause.** The bars show activity that tends to go with higher or lower return. They do not show that the activity causes it, and they are not based on anything your company reported.
- **Part of the picture.** The model explains only part of the variation in return. The bars show that explained part. What it cannot explain is not assigned to any driver.
- **Small portfolios.** The decomposition can be sensitive to small portfolios. Treat these results as directional.
- **Risk mitigation** partly reflects project maturity. Mature projects carry a longevity premium that applies to every company contributing to them, so it says more about your projects than about your motives.
- **Direct cost savings** is measured by a single driver, shared R&D, and can differ noticeably between the two estimation methods. The other categories mostly agree.
- **Extremes are understated.** The model pulls its estimates toward the middle, so the very highest and lowest returns have more behind them than the bars show.

## Common misreadings

- **"A bar at zero means this driver is worthless to us."** It means your portfolio is typical for that driver. A benefit that every pair gets equally has a bar of 0, however much value it carries.
- **"Our biggest bar is our main reason for contributing."** It is the largest measured difference from typical. Many common reasons to contribute have no measurement here, so they cannot show up.
- **"The bars are percentages of our return."** They are percentage differences from a typical pair, and they do not sum to the total.
- **"If we increased this activity our return would rise."** The chart describes association, so it cannot tell you what would happen if you changed your behavior.

## The measurements behind the chart

This section lists every proxy the chart is built from, what it measures, where it comes from, and what it can and cannot tell you. For how proxies become the chart, see [Value driver decomposition](../value-driver-decomposition/).

### How to read these tables

Each company-project pair has 19 proxies. They come in two roles:

- **Value proxy** (12). More of it should mean more benefit. Value proxies build the index of their driver and earn that driver's bar.
- **Control** (7). Kept in the model so that confounding is not credited to a driver, but not attributed to any driver. Their combined effect is the **context** component.

The rule that decides a proxy's role is in [How a proxy gets its role](../value-driver-decomposition/#how-a-proxy-gets-its-role).

The markup is scale-free, so no proxy measures spending or size directly. Every proxy is a rate, a share, a yes/no flag, a breadth, or a count that is not a spend level. Total activity volume is deliberately not used: it is what the markup itself is built from.

Some proxies describe the pair. Two kinds repeat across rows and partly describe the company or the project as a whole:

- **Project-level**: the project maturity flag and the foundation flag are the same for every company on a project.
- **Company-level**: project breadth is the same for every project of a company.

Missing data counts as 0, except where noted: event attendance rate and review share are left blank when there is nothing to take a rate of. A blank value proxy is scored as no activity.

### The 19 proxies at a glance

| Proxy                       | Driver                             | Role    | Source                                          | Window                                | Level   | Direction |
| --------------------------- | ---------------------------------- | ------- | ----------------------------------------------- | ------------------------------------- | ------- | --------- |
| Active contributor count    | Developer productivity             | Value   | Contribution activity                           | Since 2010                            | Pair    | +         |
| Active maintainer count     | Standardization leadership         | Value   | Maintainer roster                               | Current snapshot                      | Pair    | +         |
| Patch upstream rate         | Technical debt reduction           | Value   | Contribution activity                           | Since 2010                            | Pair    | + (weak)  |
| Review share                | Technical debt reduction           | Value   | Contribution activity                           | Since 2010                            | Pair    | + (weak)  |
| Project maturity flag       | Project longevity                  | Value   | Project directory                               | Current snapshot                      | Project | +         |
| Collaboration share         | Shared R&D                         | Value   | Contribution activity                           | Since 2010                            | Pair    | + (loose) |
| Foundation activity share   | Shared R&D                         | Value   | Contribution activity, project directory        | Since 2010                            | Pair    | +         |
| Talent flow count           | Talent acquisition and development | Value   | Contribution activity, contributor affiliations | Since 2010                            | Pair    | +         |
| Certificate count (log)     | Talent acquisition and development | Value   | Certificates                                    | All history                           | Pair    | +         |
| Governance engagement score | Competitive intelligence           | Value   | Meeting attendance, mailing lists               | Last 24 months (meetings), since 2010 | Pair    | + (weak)  |
| Non-code contribution rate  | Ecosystem goodwill                 | Value   | Contribution activity                           | Since 2010                            | Pair    | + (weak)  |
| Platform count              | Ecosystem goodwill                 | Value   | Contribution activity                           | Since 2010                            | Pair    | + (weak)  |
| Company project breadth     | Shared R&D                         | Control | Contribution activity                           | Since 2010                            | Company | +         |
| Foundation project flag     | Shared R&D                         | Control | Project directory                               | Current snapshot                      | Project | −         |
| Fork count                  | Technical debt reduction           | Control | Contribution activity                           | Since 2010                            | Pair    | −         |
| Project funding share       | Project longevity                  | Control | Memberships                                     | Current snapshot                      | Pair    | −         |
| Star count                  | Competitive intelligence           | Control | Contribution activity                           | Since 2010                            | Pair    | −         |
| Maintenance offload rate    | Maintenance offloading             | Control | Contribution activity                           | Since 2010                            | Pair    | −         |
| Event attendance rate       | Brand authority                    | Control | Event registrations                             | All history                           | Pair    | −         |

"Since 2010" is the ROI observation window, the same one the markup uses. Contribution activity is the deduplicated activity feed: one row per contribution, not per fork, mirror, or integration copy, with bots excluded. See [Counting each resource once](../data-overview/#counting-each-resource-once).

**Direction** is how the proxy relates to the markup. Value proxies are oriented so that more means more benefit. Controls are free to raise or lower the markup. A − control is one that lowers the markup once the other proxies are accounted for, because it is a cost or a crowding effect.

### Value proxies, by driver

#### Developer productivity

- **Active contributor count.** Developers who work on a project gain tooling and skills that speed up your own products. Measures how many of your people engage with the project: distinct people with any contribution to it. It is a headcount, so it grows with company size.

#### Standardization leadership

- **Active maintainer count.** Maintainers decide architecture and shape the standard. Measures the maintainers you employ on the project, from the project's maintainer files. It covers few pairs, and reflects the current roster, not the roster when the markup accrued.

#### Technical debt reduction

- **Patch upstream rate.** Upstreaming patches avoids maintaining a private fork. Measures the share of your commits that land on the project's main branch. Scored as 0 when you made no commits. It identifies commits only, not pull requests merged by maintainers.
- **Review share.** Reviewing and integrating other people's work is upkeep of shared code you depend on. Measures how much of your review-and-code work on the project is review: reviews divided by reviews plus commits plus pull requests opened. A share, so it does not scale with volume. Blank when there is no code or review activity at all, which is scored as no activity.

#### Project longevity

- **Project maturity flag.** Mature projects are the ones where continued maintenance, not creation, is at stake. Measures whether the project is in a late lifecycle stage (graduated, mature, adopted, or standards). It is project-level, so its bar says "mature projects carry a longevity premium", not that a particular company is motivated by longevity.

#### Shared R&D

- **Collaboration share.** Shared R&D happens through open collaboration. Measures the share of your contributions that are open conversation with the project community: issues, discussions, mailing-list messages, and wiki edits. Code review and pull-request comments are not counted. It is a loose proxy: it measures conversation, not co-development with other companies, and overlaps with the non-code contribution rate.
- **Foundation activity share.** Collaborating across the sibling projects of a foundation is how the cost of shared infrastructure is split. Measures how much of your work within the project's foundation goes to this project. Low means you spread effort across many sibling projects, and 1 means this is your only project in the foundation. It shows how concentrated your effort is, not whether peers collaborate.

#### Talent acquisition and development

- **Talent flow count.** Open source is a talent pipeline. Measures people who first contributed to the project at least 180 days before they started at your company. Their first contribution counts whether or not they were affiliated with a company, because a person usually contributes unaffiliated before being hired. It relies on contributor affiliation dates, which are noisy.
- **Certificate count (log).** Measures certificates earned by your staff for the project, as the natural log of one plus the count, so a few certificates do not dominate. It covers few pairs.

#### Competitive intelligence

- **Governance engagement score.** Taking part in project governance gives early visibility into where a technology is heading. Combines two things: your meeting attendance rate (attended divided by invited, over the last 24 months) and your mailing-list message count. Each is divided by its maximum over all pairs, so the score runs from 0 to 2.

#### Ecosystem goodwill

- **Non-code contribution rate.** Social capital comes from taking part beyond code. Measures the share of your contributions that are issues and mailing-list activity.
- **Platform count.** Using many channels on a project suggests broad engagement. Measures the most distinct platforms (git hosts, review tools, mailing lists, chat, issue trackers, meetings, events, training) you used on the project in any single calendar year. Using the maximum year keeps it independent of how long you were observed. It is a loose stand-in for goodwill.

### Controls

Controls stay in the model so that the factors below do not leak into the drivers. Their effect appears in the context component, not in any driver's bar.

| Control                  | Driver it sits next to   | Why it is a control                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company project breadth  | Shared R&D               | The number of projects you contribute to. It is the same for every project of a company, so it describes who the company is, not what a pair does. Counted as a driver it would carry a large part of shared R&D's effect, but at a cost to accuracy |
| Foundation project flag  | Shared R&D               | Whether the "project" is itself a foundation. Says nothing about how much R&D is shared, and the same for every company on it                                                                                                                        |
| Fork count               | Technical debt reduction | Forks of the project by your staff. A fork may be a private fork (debt) or simple adoption. Its effect is negative once other proxies are included                                                                                                   |
| Project funding share    | Project longevity        | Your share of the project's paid membership fees. Membership fees are part of the cost the markup is net of, so paying members have lower markups for their scale                                                                                    |
| Star count               | Competitive intelligence | Stars by your staff. Reflects exposure and crowding more than benefit                                                                                                                                                                                |
| Maintenance offload rate | Maintenance offloading   | How much of the project's work you do _not_ do (1 minus your share of all contributions). It has no coherent direction, and a company that leads development has a low rate even if it benefits a lot                                                |
| Event attendance rate    | Brand authority          | Attended divided by registered, for paid registrations on the project itself. Blank when you have no registration. Its effect is negative once other proxies are included                                                                            |

The foundation flag, fork count, funding share, star count, and event attendance rate each have a negative effect once the other proxies are in the model. Forced to behave as value proxies they would get about zero weight and lower the model's fit. Project breadth is a company label, and maintenance offload has no consistent direction at all.

### Drivers not in the chart

Nine of the 17 drivers are not in the chart. Brand authority and maintenance offloading have only controls, and the other seven have no usable proxy at all.

| Driver                                                          | Gap                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| License displacement, vendor independence                       | No usable proxy. Adopter lists and end-user memberships cover almost no pairs                                      |
| Complement for a priced good, hardware or platform pull-through | No proxy with signal. There is no software dependency data                                                         |
| Supply chain security                                           | Committee-seat and membership proxies had no signal                                                                |
| Regulatory compliance                                           | EU and programme-membership flags had no signal                                                                    |
| Brand authority, market shaping                                 | Only the event attendance rate and the funding share are available, and mention data covers foundations, not pairs |
| Maintenance offloading                                          | Only a control, the maintenance offload rate, which has no consistent direction                                    |

### Drivers only partly covered

These three drivers are in the chart, but their measurement has a known gap.

| Driver                             | Gap                                                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Talent acquisition and development | There is no job-postings data, and the two proxies rest on noisy affiliation dates and few pairs                                                                      |
| Shared R&D                         | No proxy observes co-contribution with _other companies_, because counts of co-contributing companies identify the company or project rather than describing the pair |
| Project longevity                  | The "full-time maintainers" dimension is not used. Only project maturity and funding share are                                                                        |

### Why some candidates were left out

Many candidate proxies were tested and removed. The reasons are worth knowing, because they explain why the list looks the way it does:

- **No signal.** The candidate did not relate to the markup. Examples: board and committee seat counts, security working-group membership, contributor growth rate, licence flags, industry flags, poll votes.
- **Spend-like levels.** Sponsorship dollars and speaker counts point against a scale-free markup, because heavy investors have lower markups for their scale.
- **Identity proxies.** Counts that are nearly unique to a company or project (the number of co-contributing companies, the number of peers on a project, project health score, estimated cost, project age) let a flexible model memorize _which_ company or project a row is, so a driver's bar would really mean "which project this is". They help on projects the model has seen and hurt on ones it has not.
- **Stand-ins for raw activity volume.** Percentiles of activity, activity relative to peers, and growth rates restate the markup's own input.
- **Overlap.** Several membership measures were highly correlated with the funding share, which is the one kept. Programme memberships, mentorship, and course and sponsorship flags overlap with the markup's own participation record or had no signal.

## Related reading

- [Interpreting results](../interpreting-results/)
- [Value driver decomposition](../value-driver-decomposition/) — the method, in full
- [Data overview](../data-overview/)
- [ROI documentation](../)
