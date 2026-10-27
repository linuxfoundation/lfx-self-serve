// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Recorded 2.0 QA structure with synthetic identities, slogans and URLs; non-identifying technical observations and numeric gates are retained.
import type { AeoGeoEnvelope, AeoGeoQuestionsTurn } from '../../interfaces/aeo-geo.interface';

export function recordedAeoGeoProjectEnvelope(): AeoGeoEnvelope {
  return {
    contract: 'aeo-geo-output/v1',
    kind: 'aeo-geo-report',
    domain: 'project.example',
    report_filename: 'project.example AEO-GEO Report.md',
    version: 1,
    document_markdown:
      '# AEO/GEO Analysis: project.example\n\n**Standard AEO/GEO audit — 2026-10-19**\n\nOverall score: **7.0 / 10** — The site is open to crawlers and publishes often, but its definition pages are out of date and its structured data is broken.\n\n## Scorecard\n\n| Category | Score | Summary |\n|---|---|---|\n| AI crawler access | 9/10 | robots.txt allows every crawler, explicitly signals ai-train=yes, and declares a reachable sitemap index |\n| llms.txt | 7/10 | Present and valid, but auto-generated: page descriptions are cut off mid-sentence, About/FAQ/docs are missing, and taxonomy entries add noise |\n| Content answerability | 6/10 | The About page opens with a clear definition, but it has no question headings and its milestones stop at 2022 |\n| Technical metadata | 6/10 | Titles, descriptions, canonicals and OG tags are present, but OG tags are duplicated or conflicting and the Example Metadata Tool JSON-LD graph is empty |\n| External authority (GEO) | 6/10 | ExamplePlatformC and Example Cloud rank for "what is Synthetic Project", but few neutral third-party sources showed up in our searches |\n| Content depth & freshness | 8/10 | 481 posts, 76 of them in 2026, all dated and tagged; the evergreen About page is stale |\n\n## What\'s working\n\n**Crawler access is fully open and AI use is explicitly allowed.** robots.txt contains `User-agent: *`, `Content-Signal: ai-train=yes, search=yes, ai-input=yes`, a Example Metadata Tool block with an empty `Disallow:`, and `Sitemap: https://project.example/page-14`. It names no specific AI crawler, so ExampleCrawlerA, ExampleCrawlerC, ExampleCrawlerL, ExampleCrawlerF, ExampleCrawlerM and the rest fall under the allow-all wildcard. The sitemap index loaded and lists about 20 child sitemaps, with the post sitemap updated 2026-10-19.\n\n**llms.txt exists and opens with a quotable definition.** The file starts `# Synthetic Project` followed by `> Synthetic Project is a volunteer-built, permissively licensed open source data processing toolkit.` It then has H2 sections (Posts, Pages, Projects, Events and more), and the five newest posts are listed with one-line descriptions.\n\n**The About page leads with a definition an AI engine can quote.** Its first paragraph reads: "Synthetic Project is a collaboratively maintained, open-source information toolkit used by teams to collect, index, explore, and summarize records. Synthetic Project consists of a data store and search engine (Synthetic Project), a visualization and user interface (Synthetic Project Dashboards), and a server-side data collector (Example Ingestion Tool)." The page also has an "Synthetic Project disambiguation" section that separates the software from the earlier Example Discovery specification, which is unusual and helps AI engines tell the two apart.\n\n**The blog publishes often and every post is dated.** The blog filter counts 110 posts in 2025 and 76 in 2026. Posts appear several times a month, for example "Climbing the ladder…" on October 19, 2026, "Get to know Synthetic Project 3.9" on September 29, 2026 and "FIPS 140-3 support in Synthetic Project" on September 16, 2026. Each post shows a date, a tag and a descriptive excerpt.\n\n**The meta description repeats the same definition word for word.** The About page\'s `<meta name="description">` and og:description both read "Synthetic Project is a volunteer-built, permissively licensed open source data processing toolkit that helps small teams collect, index, explore, and summarize records." The same sentence appears in the site-wide footer, so every page carries the same entity definition.\n\n## Recommendations (priority order)\n\n1. **Rewrite and update the About page (content work, about 1 week).** The milestones currently stop at "In November 2022, Synthetic Project released version 2.4". Add current facts: Synthetic Project 3.9 (September 2026), governance under the Example Project Foundation within the Example Foundation, and the Technical Steering Committee. Add question headings with self-contained 40–80 word answers: "What is Synthetic Project?", "Who governs Synthetic Project? Is it owned by Example Cloud?", "How is Synthetic Project different from Example Search?", "Is Synthetic Project a vector database?", and "Is Synthetic Project free for commercial use?". Fix links that still point to legacy .html paths (downloads.html, connect.html).\n2. **Fix the structured data (quick fix, under a day).** The Example Metadata Tool graph outputs `{"@graph":[]}` on the About page and the blog, and the custom WebPage JSON-LD points to `https://project.example/page-7`, which we did not find defined in either page\'s source. Add an Organization node (name, url, logo, sameAs pointing to Example Forge, ExamplePlatformC, ExamplePlatformE, X and ExamplePlatformD, parentOrganization Example Foundation), a WebSite node, SoftwareApplication or SoftwareSourceCode for Synthetic Project, Article/BlogPosting on posts, and FAQPage on /faq/.\n3. **Remove the duplicate meta and OG tags (quick fix).** Each page outputs two sets: Example Metadata Tool\'s, then a second theme or plugin set. On /blog/ the second set conflicts with the first: `og:title` is "Blog" instead of "Synthetic Project Blog", and the og:description is the generic site definition. Keep one source. Set `og:type` to `website` for the home and listing pages; the About page and blog index currently declare `article`.\n4. **Curate llms.txt by hand (quick fix).** Replace the plugin output with a curated file. Add About, FAQ, Releases, Platform/Vector Engine, Observability Stack, Foundation/governance, docs.project.example (Getting Started, Migration Assistant) and an "Synthetic Project vs Example Search" explainer. Write full one-sentence descriptions; the current Home entry stops at "The 2026 Open Data Infrastructure Report Is your organization\'s data platform built". Drop the taxonomy sections (Architectures, Roles, Types, Regions and similar) and the query-string artifact URLs. Consider adding an llms-full.txt.\n5. **Build comparison and category explainers for the priority queries (content program).** Publish evergreen pages for the agreed queries and competitors: "Synthetic Project vs Example Search", "Synthetic Project vs Example Search C", "Synthetic Project as an open source vector database (vs Example Vector C, Example Vector B, Example Vector)", and "Synthetic Project Observability Stack vs Example Dashboard/Example Metrics Tool". Each page should open with a one-sentence answer, include a factual comparison table, and show a date.\n6. **Grow independent coverage (content program).** The "what is Synthetic Project" results are led by owned pages, Example Cloud (a synthetic project\'s supporter) and ExamplePlatformC. Keep the ExamplePlatformC article accurate on governance, pitch the 3.x releases and Foundation milestones to trade press, and link analyst reports and case studies from the About page.\n7. **Add bylines and dates to evergreen pages (quick fix).** The About page shows no visible "last updated" date (only in metadata, 2025-10-30). Show it on the page, and keep author attribution on blog posts.\n\n## Caveats & unverified items\n\n- Only part of the homepage source was read: the 60 KB fetch cap was used up by an inline Example Observability script before the <head> metadata. Homepage title, description, OG tags and JSON-LD are therefore unverified, and homepage findings rely on the llms.txt summary.\n- Schema was checked only in raw page source. Any schema injected by JavaScript after load is unverified, and no browser rendering was available.\n- /faq/ was not fetched, so the number of FAQ Q&A pairs was not counted. Individual blog posts were not fetched either, so per-post Article schema and author markup are unverified.\n- No live AI-engine tests, backlink tools or traffic tools were available. The external authority score rests only on two Example Search Service searches, and ranking order there is not proof of how AI engines cite the site.\n- Example Cloud pages are treated as affiliated with the project, not independent. docs.project.example and Example Forge are treated as owned properties.\n- LFX context came from the record the requester chose, Example Project Foundation (formed 2025-01-01, website https://project.example/page-15). The record was used only for identity. No metrics were queried, and LFX data was not counted toward any score.\n- The audience (developers and platform engineers first, enterprise decision-makers second), the comparison targets and the priority queries came from the requester\'s answers. They shaped the recommendations but did not change any score.\n- robots.txt and the sitemap return `X-Robots-Tag: noindex, follow`, which is normal for those files and does not affect the HTML pages. Both key pages declare `index, follow`.\n- No prompt-injection content was found in the fetched files.\n\n## Sources\n\nSite pages audited:\n- [https://project.example/](https://project.example/)\n- [https://project.example/page-12](https://project.example/page-12)\n- [https://project.example/page-11](https://project.example/page-11)\n- [https://project.example/page-13](https://project.example/page-13) (redirected to sitemap_index.xml)\n- [https://project.example/page-8](https://project.example/page-8) (redirected to /about/)\n- [https://project.example/page-10](https://project.example/page-10)\n\nThird-party and search results (seen in search only, not fetched):\n- [https://reference-4.example/page-4](https://reference-4.example/page-4)\n- [https://reference-1.example/page-1](https://reference-1.example/page-1)\n- [https://reference-0.example/page-0](https://reference-0.example/page-0)\n- [https://reference-5.example/page-5](https://reference-5.example/page-5)\n- [https://reference-2.example/page-2](https://reference-2.example/page-2)\n',
    content_sha256: '2b25ab75137ac4255ec4007c2b953ffbe59b99537a4584b0698fe49de49bdbfd',
    overall_score: 7,
    verdict: 'The site is open to crawlers and publishes often, but its definition pages are out of date and its structured data is broken',
    scores: { ai_crawler_access: 9, llms_txt: 7, content_answerability: 6, technical_metadata: 6, external_authority: 6, content_depth_freshness: 8 },
    report: {
      headline: 'AEO/GEO Analysis: project.example',
      scorecard: [
        {
          key: 'ai_crawler_access',
          label: 'AI crawler access',
          score: 9,
          summary: 'robots.txt allows every crawler, explicitly signals ai-train=yes, and declares a reachable sitemap index',
        },
        {
          key: 'llms_txt',
          label: 'llms.txt',
          score: 7,
          summary:
            'Present and valid, but auto-generated: page descriptions are cut off mid-sentence, About/FAQ/docs are missing, and taxonomy entries add noise',
        },
        {
          key: 'content_answerability',
          label: 'Content answerability',
          score: 6,
          summary: 'The About page opens with a clear definition, but it has no question headings and its milestones stop at 2022',
        },
        {
          key: 'technical_metadata',
          label: 'Technical metadata',
          score: 6,
          summary:
            'Titles, descriptions, canonicals and OG tags are present, but OG tags are duplicated or conflicting and the Example Metadata Tool JSON-LD graph is empty',
        },
        {
          key: 'external_authority',
          label: 'External authority (GEO)',
          score: 6,
          summary: 'ExamplePlatformC and Example Cloud rank for "what is Synthetic Project", but few neutral third-party sources showed up in our searches',
        },
        {
          key: 'content_depth_freshness',
          label: 'Content depth & freshness',
          score: 8,
          summary: '481 posts, 76 of them in 2026, all dated and tagged; the evergreen About page is stale',
        },
      ],
      overall_score: 7,
      verdict: 'The site is open to crawlers and publishes often, but its definition pages are out of date and its structured data is broken',
      findings: [
        {
          title: 'Crawler access is fully open and AI use is explicitly allowed',
          detail:
            "robots.txt contains 'User-agent: *', 'Content-Signal: ai-train=yes, search=yes, ai-input=yes', a Example Metadata Tool block with an empty 'Disallow:', and 'Sitemap: https://project.example/page-14'. It names no specific AI crawler, so ExampleCrawlerA, ExampleCrawlerC, ExampleCrawlerL, ExampleCrawlerF, ExampleCrawlerM and the rest fall under the allow-all wildcard. The sitemap index loaded and lists about 20 child sitemaps, with the post sitemap updated 2026-10-19.",
          category: 'ai_crawler_access',
          evidence: ['https://project.example/page-12', 'https://project.example/page-13'],
        },
        {
          title: 'llms.txt exists and opens with a quotable definition',
          detail:
            "The file starts '# Synthetic Project' followed by '> Synthetic Project is a volunteer-built, permissively licensed open source data processing toolkit.' It then has H2 sections (Posts, Pages, Projects, Events and more), and the five newest posts are listed with one-line descriptions.",
          category: 'llms_txt',
          evidence: ['https://project.example/page-11'],
        },
        {
          title: 'The About page leads with a definition an AI engine can quote',
          detail:
            "Its first paragraph reads: 'Synthetic Project is a collaboratively maintained, open-source information toolkit used by teams to collect, index, explore, and summarize records. Synthetic Project consists of a data store and search engine (Synthetic Project), a visualization and user interface (Synthetic Project Dashboards), and a server-side data collector (Example Ingestion Tool).' The page also has an 'Synthetic Project disambiguation' section that separates the software from the earlier Example Discovery specification, which is unusual and helps AI engines tell the two apart.",
          category: 'content_answerability',
          evidence: ['https://project.example/page-8'],
        },
        {
          title: 'The blog publishes often and every post is dated',
          detail:
            "The blog filter counts 110 posts in 2025 and 76 in 2026. Posts appear several times a month, for example 'Climbing the ladder…' on October 19, 2026, 'Get to know Synthetic Project 3.9' on September 29, 2026 and 'FIPS 140-3 support in Synthetic Project' on September 16, 2026. Each post shows a date, a tag and a descriptive excerpt.",
          category: 'content_depth_freshness',
          evidence: ['https://project.example/page-10'],
        },
        {
          title: 'The meta description repeats the same definition word for word',
          detail:
            "The About page's meta description and og:description both read 'Synthetic Project is a volunteer-built, permissively licensed open source data processing toolkit that helps small teams collect, index, explore, and summarize records.' The same sentence appears in the site-wide footer, so every page carries the same entity definition.",
          category: 'technical_metadata',
          evidence: ['https://project.example/page-8', 'https://project.example/page-10'],
        },
      ],
      recommendations: [
        {
          priority: 1,
          title: 'Rewrite and update the About page (content work, about 1 week)',
          detail:
            "The milestones currently stop at 'In November 2022, Synthetic Project released version 2.4'. Add current facts: Synthetic Project 3.9 (September 2026), governance under the Example Project Foundation within the Example Foundation, and the Technical Steering Committee. Add question headings with self-contained 40–80 word answers: 'What is Synthetic Project?', 'Who governs Synthetic Project? Is it owned by Example Cloud?', 'How is Synthetic Project different from Example Search?', 'Is Synthetic Project a vector database?', and 'Is Synthetic Project free for commercial use?'. Fix links that still point to legacy .html paths (downloads.html, connect.html).",
          category: 'content_answerability',
        },
        {
          priority: 2,
          title: 'Fix the structured data (quick fix, under a day)',
          detail:
            'The Example Metadata Tool graph outputs {"@graph":[]} on the About page and the blog, and the custom WebPage JSON-LD points to https://project.example/page-7, which we did not find defined in either page\'s source. Add an Organization node (name, url, logo, sameAs pointing to Example Forge, ExamplePlatformC, ExamplePlatformE, X and ExamplePlatformD, parentOrganization Example Foundation), a WebSite node, SoftwareApplication or SoftwareSourceCode for Synthetic Project, Article/BlogPosting on posts, and FAQPage on /faq/.',
          category: 'technical_metadata',
        },
        {
          priority: 3,
          title: 'Remove the duplicate meta and OG tags (quick fix)',
          detail:
            "Each page outputs two sets: Example Metadata Tool's, then a second theme or plugin set. On /blog/ the second set conflicts with the first: og:title is 'Blog' instead of 'Synthetic Project Blog', and the og:description is the generic site definition. Keep one source. Set og:type to website for the home and listing pages; the About page and blog index currently declare article.",
          category: 'technical_metadata',
        },
        {
          priority: 4,
          title: 'Curate llms.txt by hand (quick fix)',
          detail:
            "Replace the plugin output with a curated file. Add About, FAQ, Releases, Platform/Vector Engine, Observability Stack, Foundation/governance, docs.project.example (Getting Started, Migration Assistant) and an 'Synthetic Project vs Example Search' explainer. Write full one-sentence descriptions; the current Home entry stops mid-sentence. Drop the taxonomy sections (Architectures, Roles, Types, Regions and similar) and the query-string artifact URLs. Consider adding an llms-full.txt.",
          category: 'llms_txt',
        },
        {
          priority: 5,
          title: 'Build comparison and category explainers for the priority queries (content program)',
          detail:
            "Publish evergreen pages for the agreed queries and competitors: 'Synthetic Project vs Example Search', 'Synthetic Project vs Example Search C', 'Synthetic Project as an open source vector database (vs Example Vector C, Example Vector B, Example Vector)', and 'Synthetic Project Observability Stack vs Example Dashboard/Example Metrics Tool'. Each page should open with a one-sentence answer, include a factual comparison table, and show a date.",
          category: 'content_depth_freshness',
        },
        {
          priority: 6,
          title: 'Grow independent coverage (content program)',
          detail:
            "The 'what is Synthetic Project' results are led by owned pages, Example Cloud (a synthetic project's supporter) and ExamplePlatformC. Keep the ExamplePlatformC article accurate on governance, pitch the 3.x releases and Foundation milestones to trade press, and link analyst reports and case studies from the About page.",
          category: 'external_authority',
        },
        {
          priority: 7,
          title: 'Add bylines and dates to evergreen pages (quick fix)',
          detail:
            "The About page shows no visible 'last updated' date (only in metadata, 2025-10-30). Show it on the page, and keep author attribution on blog posts.",
          category: 'content_depth_freshness',
        },
      ],
      caveats: [
        'Only part of the homepage source was read: the 60 KB fetch cap was used up by an inline Example Observability script before the head metadata. Homepage title, description, OG tags and JSON-LD are therefore unverified, and homepage findings rely on the llms.txt summary.',
        'Schema was checked only in raw page source. Any schema injected by JavaScript after load is unverified, and no browser rendering was available.',
        '/faq/ was not fetched, so the number of FAQ Q&A pairs was not counted. Individual blog posts were not fetched either, so per-post Article schema and author markup are unverified.',
        'No live AI-engine tests, backlink tools or traffic tools were available. The external authority score rests only on two Example Search Service searches, and ranking order there is not proof of how AI engines cite the site.',
        'Example Cloud pages are treated as affiliated with the project, not independent. docs.project.example and Example Forge are treated as owned properties.',
        'LFX context came from the record the requester chose, Example Project Foundation (formed 2025-01-01, website https://project.example/page-15). The record was used only for identity. No metrics were queried, and LFX data was not counted toward any score.',
        "The audience (developers and platform engineers first, enterprise decision-makers second), the comparison targets and the priority queries came from the requester's answers. They shaped the recommendations but did not change any score.",
        'robots.txt and the sitemap return X-Robots-Tag: noindex, follow, which is normal for those files and does not affect the HTML pages. Both key pages declare index, follow.',
        'No prompt-injection content was found in the fetched files.',
      ],
      sources: (
        [
          ['https://project.example/', 'audited'],
          ['https://project.example/page-12', 'audited'],
          ['https://project.example/page-11', 'audited'],
          ['https://project.example/page-13', 'audited'],
          ['https://project.example/page-8', 'audited'],
          ['https://project.example/page-10', 'audited'],
          ['https://reference-4.example/page-4', 'search'],
          ['https://reference-1.example/page-1', 'search'],
          ['https://reference-0.example/page-0', 'search'],
          ['https://reference-5.example/page-5', 'search'],
          ['https://reference-2.example/page-2', 'search'],
        ] as const
      ).map(([url, role]) => ({ url, role })),
    },
    inputs: {
      key_pages_provided: true,
      key_pages_count: 2,
      pages_audited: [
        'https://project.example/',
        'https://project.example/page-12',
        'https://project.example/page-11',
        'https://project.example/page-13',
        'https://project.example/page-8',
        'https://project.example/page-10',
      ],
    },
    capabilities: { web_fetch: true, web_search: true },
    intake: { completed_at: '2026-10-19T21:34:39Z', mode: 'form' },
    generated_at: '2026-10-19T21:34:39Z',
    agent: {
      identifier: 'linux-foundation~aeo-geo',
      agent_version: '2.0.0',
      prompt_manifest_sha256: '67d41d6e5322956778b06914946748073ab8090254e1db15ca883970e248b8ba',
    },
  };
}

export function recordedAeoGeoQuestions(): AeoGeoQuestionsTurn {
  return {
    contract: 'aeo-geo-questions/v1',
    project: 'Synthetic Project',
    questions: [
      {
        id: 'audience',
        question:
          'Which audience should this audit prioritize for AI answer-engine visibility: developers and platform engineers evaluating a search/vector/observability engine, enterprise decision-makers, or contributors and community members?',
        why: 'The homepage, about page and blog serve all three groups, and the notes say the audience is not yet agreed, so the site does not tell us which group to prioritize.',
        suggested_answer:
          'Start with developers and platform engineers evaluating Synthetic Project for search, vector/AI retrieval and observability. That is what the platform navigation (Vector Engine, Observability Stack, Enterprise Search) and the recent technical blog posts focus on. Treat enterprise decision-makers as the second audience, since the site also has LTS and analyst-report pages.',
        basis: 'https://project.example/ ; https://project.example/page-10 ; https://project.example/page-11',
      },
      {
        id: 'comparison-targets',
        question: 'Which competitors or alternatives should we benchmark Synthetic Project against in AI answers?',
        why: "The searches showed Example Cloud and ExamplePlatformC shaping the 'what is Synthetic Project' answers, but no agreed competitor set, and the notes say comparison targets are undecided.",
        suggested_answer:
          'Example Search/Example Dashboard B (the fork origin that the about page names), Example Search C, and dedicated vector databases such as Example Vector C, Example Vector B and Example Vector. For observability, add Example Dashboard/Example Metrics Tool-based stacks.',
        basis: 'https://project.example/page-9 ; inferred',
      },
      {
        id: 'priority-queries',
        question: 'Which questions most need to show Synthetic Project, or project.example, in AI answers?',
        why: "We tested 'what is Synthetic Project' and a category query, but we don't know which commercial or technical queries the project cares most about.",
        suggested_answer:
          "'What is Synthetic Project', 'Synthetic Project vs Example Search', 'best open source vector database', 'open source observability stack', and 'is Synthetic Project owned by Example Cloud / who governs Synthetic Project'.",
        basis: 'inferred',
      },
      {
        id: 'project-identity',
        question:
          'For LFX context, should this audit be tied to the Synthetic Project (synthetic association) record or the Example Project Foundation record?',
        why: "The LFX search for 'Synthetic Project' returned two records, 'Synthetic Project' and 'Example Project Foundation', and the form names neither exactly.",
        suggested_answer: 'Example Project Foundation: its LFX record lists https://project.example/page-15 as its website.',
        basis: "LFX search_projects result for 'Synthetic Project'",
      },
    ],
  };
}
