// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Recorded 2.0 QA structure with synthetic identities, slogans and URLs; non-identifying technical observations and numeric gates are retained.
import type { AeoGeoEnvelope } from '../../interfaces/aeo-geo.interface';

export function recordedAeoGeoDomainEnvelope(): AeoGeoEnvelope {
  return {
    contract: 'aeo-geo-output/v1',
    kind: 'aeo-geo-report',
    domain: 'domain.example',
    report_filename: 'domain.example AEO-GEO Report.md',
    version: 1,
    document_markdown:
      '# AEO/GEO Analysis: domain.example\n\n**Standard AEO/GEO audit — 2026-10-19**\n\nOverall score: **8.0 / 10** — An exceptionally AI-crawlable, frequently updated site held back by placeholder FAQ schema, a truncated Projects description and thin independent coverage.\n\n## Scorecard\n\n| Category | Score | Summary |\n|---|---|---|\n| AI crawler access | 10/10 | robots.txt explicitly welcomes 19 AI user agents, declares the sitemap and only disallows /api/ and /sandbox |\n| llms.txt | 8/10 | Valid, rich llms.txt with H1, summary, Pages and Blog sections, but the Projects entry is truncated and there is no section for the hosted projects |\n| Content answerability | 7/10 | The About page has a quotable "What is the Example AI Foundation?" answer, but the homepage leads with a slogan and the FAQ has only three placeholder answers |\n| Technical metadata | 7/10 | Titles, descriptions, canonicals, ExamplePlatformG cards and correct og:type are present, but the FAQPage schema is inaccurate, the Projects description is cut off and About has no og:image |\n| External authority (GEO) | 7/10 | Independent coverage found in Example Tech Press and Example Industry Journal, plus founder and Example Foundation announcements; little independent coverage after launch was found |\n| Content depth & freshness | 9/10 | Near-daily, author-attributed blog posts through October 2026, with deep explainers on tool protocol, ETE, PROJECT.md and sample-gateway |\n\n## What\'s working\n\n**AI crawlers are explicitly welcomed.** robots.txt opens with `User-agent: *` / `Content-Signal: search=yes, ai-input=yes, ai-train=yes` / `Allow: /`, then names ExampleCrawlerA, ExampleCrawlerB, Example Assistant Agent, ExampleCrawlerC, ExampleCrawlerI, ExampleCrawlerF, ExampleCrawlerL, ExampleCrawlerK-Extended, ExampleCrawlerM, ExampleCrawlerJ and others with the same allow rules. It disallows only `/api/` and `/sandbox`, and it declares `Sitemap: https://domain.example/page-7`. The sitemap is reachable and shows lastmod values from the audit date. Every fetched page has `<meta name="robots" content="index, follow">`.\n\n**The llms.txt and Markdown mirrors are well above average.** /llms.txt has a valid H1 (`# Example AI Foundation (Example AI Foundation)`) and a blockquote summary. It has a `## Pages` section with descriptions for about 21 core pages and a long `## Blog` section with a summary for each post. It also tells agents that "any page is also available as Markdown — prefix its path with /md/". The homepage sends a `Link` header that points to `/md`, `/llms.txt` and `/sitemap.xml`. Few sites provide this kind of discovery for AI agents.\n\n**The About page has a clean, quotable definition.** /md/about contains the question heading "What is the Example AI Foundation?", followed by: "The Example AI Foundation (Example AI Foundation) is a neutral, open foundation under the Example Foundation that hosts open protocols and open source projects for agentic AI, including the Example Tool Protocol (tool protocol), sample-agent, PROJECT.md, Example Task Exchange (ETE) and sample-gateway." This is a self-contained answer that answer engines can quote. The page also uses the question heading "Who governs Example AI Foundation?".\n\n**The core metadata and Organization schema are solid.** Each page we fetched has a unique title, for example "About - Example AI Foundation (Example AI Foundation)". Each also has a canonical URL, OG and ExamplePlatformG tags, and the correct og:type: `website` on the homepage, About and Projects, and `article` on the blog post. The page source includes JSON-LD for `WebSite` and `Organization`, with `alternateName: "Example AI Foundation"`, sameAs links to Example Forge, ExamplePlatformA, ExamplePlatformF, ExamplePlatformE and ExamplePlatformB, and `parentOrganization` set to The Example Foundation.\n\n**Publishing is frequent and recent.** The sitemap lists blog posts with lastmod dates of 2026-10-19, 10-16, 10-15, 10-14, 10-13, 10-09, 10-08 and 10-07, plus more than 30 author pages (/author/...). Topics include practical explainers that match likely search questions, such as "tool protocol 2026-07-28: What\'s Changing and How to Migrate", "Writing an effective PROJECT.md" and "How Does Agentic Commerce Work?".\n\n## Recommendations (priority order)\n\n1. **Replace the placeholder FAQPage schema on the homepage (quick fix, high priority).** The homepage JSON-LD `FAQPage` currently says "You can create projects directly from your dashboard after signing up" and "Yes, Example AI Foundation offers a free tier with access to core features. Premium tiers are available…". These read like template text and do not describe a Example Foundation foundation. AI engines could repeat them as fact. Replace them with at least eight accurate pairs, and show the same questions and answers in a visible FAQ section. Suggested questions: What is the Example AI Foundation? Which projects does Example AI Foundation host (tool protocol, sample-agent, PROJECT.md, ETE, sample-gateway, Example Task Router)? How is Example AI Foundation governed? How does my organization become a member? How do I submit a project (including the Sandbox phase)? What is the relationship between Example AI Foundation and the Example Foundation? What is Example Credential certification? When and where is Example Agent Summit?\n2. **Fix the truncated Projects description (quick fix).** /projects uses "Example AI Foundation supports shared technical components" as its meta description, og:description, ExamplePlatformG:description and llms.txt entry. Rewrite it as a complete sentence of 140–160 characters, for example: "Example AI Foundation hosts open protocols and open source projects for agentic AI, including tool protocol, sample-agent, PROJECT.md, ETE, sample-gateway and Example Task Router."\n3. **Lead the homepage with the entity definition (quick fix).** The homepage H1 is "Shared tooling grows through reusable interfaces and open collaboration. So will reliable automation.", which is a slogan rather than a definition. Add the About definition sentence as visible copy just below the H1, so crawlers that read only the homepage can extract it.\n4. **Add a `## Projects` section to llms.txt (quick fix).** Give one line per hosted project, linking to its project page or repository and describing it in one sentence. Make sure no descriptions are cut off; for example, several blog summaries end mid-word, such as "…or the or". Consider moving the blog index into a separate /llms-full.txt or a capped "recent posts" list.\n5. **Add Article/BlogPosting and Person schema to blog posts (moderate effort).** In the server HTML of the blog post we checked, we saw only `WebSite` and `Organization` JSON-LD. Add `BlogPosting` with `headline`, `datePublished`, `dateModified`, `author` (linked to the /author/ page as `Person`) and `publisher`. Also add `og:image` to /about, which currently has none.\n6. **Grow independent coverage beyond launch (ongoing content program).** Pitch trade press such as Example Engineering Journal, Example Platform Journal and Example Industry Journal on milestones like the tool protocol 2026-07-28 release, the ETE and Example Task Router additions and Example Credential certification. Create or improve a neutral ExamplePlatformC entry backed by the Example Tech Press and Example Industry Journal coverage, and encourage member companies to publish case studies that link to domain.example.\n\n## Caveats & unverified items\n\n- No live AI-engine tests were run with Example Assistant A, Example Assistant B, Example Assistant C, Example Assistant D or Example Search Vendor AI Overviews, and no backlink or traffic tools (Example SEO Service A, Example SEO Service B) were available. Citation and traffic claims are therefore unverified.\n- Search findings reflect only the Example Search Service results returned during this audit. They do not prove how any engine ranks the site. domain.example/about and domain.example appeared near the top for "what is the Example AI Foundation".\n- Large files were fetched only in part: the homepage up to 60 KB, llms.txt and sitemap.xml up to 30 KB, and /about, /projects and the blog post up to 8 KB each. Schema and body content beyond those limits, such as possible BlogPosting markup or visible FAQ text later in a page, could not be checked. We had no browser, so schema added by client-side JavaScript was not checked either.\n- /md/about returns `x-robots-tag: noindex`. This seems intended, to avoid duplicating the HTML pages, and is not counted as a problem.\n- LFX context was unavailable because the form supplied no LFX project scope, so no project records or metrics were read.\n- No requester context was supplied (audience, comparison targets, priorities). The audit assumes developers, enterprise platform teams and prospective member organizations are the target audience.\n- Example AI Lab, Example Research and Example Systems are co-founders, and the Example Foundation is the parent organization. Their announcements are counted as affiliated sources, not independent coverage.\n\n## Sources\n\nSite pages audited:\n- [https://domain.example/](https://domain.example/)\n- [https://domain.example/page-6](https://domain.example/page-6)\n- [https://domain.example/page-3](https://domain.example/page-3)\n- [https://domain.example/page-7](https://domain.example/page-7)\n- [https://domain.example/page-1](https://domain.example/page-1)\n- [https://domain.example/page-4](https://domain.example/page-4)\n- [https://domain.example/page-5](https://domain.example/page-5)\n- [https://domain.example/page-2](https://domain.example/page-2)\n\nThird-party and affiliated coverage (search results only; not fetched):\n- [Example Tech Press: Example AI Lab, Example Research, and Example Systems join new Example Foundation effort](https://reference-10.example/page-10)\n- [Example Industry Journal: Example Foundation launches Example AI Foundation](https://reference-12.example/page-12)\n- [Example Foundation press: Formation of the Example AI Foundation](https://reference-14.example/page-14)\n- [Example Foundation press: Example Credential certification](https://reference-13.example/page-13)\n- [Example AI Lab: co-founds the Example AI Foundation](https://reference-9.example/page-9)\n- [Example Research: Donating tool protocol to the Example AI Foundation](https://reference-11.example/page-11)\n- [Example Systems: Example Systems, Example Research, and Example AI Lab launch the Example AI Foundation](https://reference-8.example/page-8)\n',
    content_sha256: 'b5ccc7b0e0a42d1f4548a9a22b02992bfa46f5deffd1bceebe205dda0ac8d390',
    overall_score: 8,
    verdict:
      'An exceptionally AI-crawlable, frequently updated site held back by placeholder FAQ schema, a truncated Projects description and thin independent coverage',
    scores: { ai_crawler_access: 10, llms_txt: 8, content_answerability: 7, technical_metadata: 7, external_authority: 7, content_depth_freshness: 9 },
    report: {
      headline: 'AEO/GEO Analysis: domain.example',
      scorecard: [
        {
          key: 'ai_crawler_access',
          label: 'AI crawler access',
          score: 10,
          summary: 'robots.txt explicitly welcomes 19 AI user agents, declares the sitemap and only disallows /api/ and /sandbox',
        },
        {
          key: 'llms_txt',
          label: 'llms.txt',
          score: 8,
          summary:
            'Valid, rich llms.txt with H1, summary, Pages and Blog sections, but the Projects entry is truncated and there is no section for the hosted projects',
        },
        {
          key: 'content_answerability',
          label: 'Content answerability',
          score: 7,
          summary:
            'The About page has a quotable "What is the Example AI Foundation?" answer, but the homepage leads with a slogan and the FAQ has only three placeholder answers',
        },
        {
          key: 'technical_metadata',
          label: 'Technical metadata',
          score: 7,
          summary:
            'Titles, descriptions, canonicals, ExamplePlatformG cards and correct og:type are present, but the FAQPage schema is inaccurate, the Projects description is cut off and About has no og:image',
        },
        {
          key: 'external_authority',
          label: 'External authority (GEO)',
          score: 7,
          summary:
            'Independent coverage found in Example Tech Press and Example Industry Journal, plus founder and Example Foundation announcements; little independent coverage after launch was found',
        },
        {
          key: 'content_depth_freshness',
          label: 'Content depth & freshness',
          score: 9,
          summary: 'Near-daily, author-attributed blog posts through October 2026, with deep explainers on tool protocol, ETE, PROJECT.md and sample-gateway',
        },
      ],
      overall_score: 8,
      verdict:
        'An exceptionally AI-crawlable, frequently updated site held back by placeholder FAQ schema, a truncated Projects description and thin independent coverage',
      findings: [
        {
          title: 'AI crawlers are explicitly welcomed',
          detail:
            'robots.txt opens with `User-agent: *` / `Content-Signal: search=yes, ai-input=yes, ai-train=yes` / `Allow: /`, then names ExampleCrawlerA, ExampleCrawlerB, Example Assistant Agent, ExampleCrawlerC, ExampleCrawlerI, ExampleCrawlerF, ExampleCrawlerL, ExampleCrawlerK-Extended, ExampleCrawlerM, ExampleCrawlerJ and others with the same allow rules. It disallows only `/api/` and `/sandbox`, and it declares `Sitemap: https://domain.example/page-7`. The sitemap is reachable and shows lastmod values from the audit date. Every fetched page has `<meta name="robots" content="index, follow">`.',
          category: 'ai_crawler_access',
          evidence: ['https://domain.example/page-6', 'https://domain.example/page-7'],
        },
        {
          title: 'The llms.txt and Markdown mirrors are well above average',
          detail:
            '/llms.txt has a valid H1 (`# Example AI Foundation (Example AI Foundation)`) and a blockquote summary. It has a `## Pages` section with descriptions for about 21 core pages and a long `## Blog` section with a summary for each post. It also tells agents that "any page is also available as Markdown — prefix its path with /md/". The homepage sends a `Link` header that points to `/md`, `/llms.txt` and `/sitemap.xml`. Few sites provide this kind of discovery for AI agents.',
          category: 'llms_txt',
          evidence: ['https://domain.example/page-3', 'https://domain.example/'],
        },
        {
          title: 'The About page has a clean, quotable definition',
          detail:
            '/md/about contains the question heading "What is the Example AI Foundation?", followed by: "The Example AI Foundation (Example AI Foundation) is a neutral, open foundation under the Example Foundation that hosts open protocols and open source projects for agentic AI, including the Example Tool Protocol (tool protocol), sample-agent, PROJECT.md, Example Task Exchange (ETE) and sample-gateway." This is a self-contained answer that answer engines can quote. The page also uses the question heading "Who governs Example AI Foundation?".',
          category: 'content_answerability',
          evidence: ['https://domain.example/page-4', 'https://domain.example/page-1'],
        },
        {
          title: 'The core metadata and Organization schema are solid',
          detail:
            'Each page we fetched has a unique title, for example "About - Example AI Foundation (Example AI Foundation)". Each also has a canonical URL, OG and ExamplePlatformG tags, and the correct og:type: `website` on the homepage, About and Projects, and `article` on the blog post. The page source includes JSON-LD for `WebSite` and `Organization`, with `alternateName: "Example AI Foundation"`, sameAs links to Example Forge, ExamplePlatformA, ExamplePlatformF, ExamplePlatformE and ExamplePlatformB, and `parentOrganization` set to The Example Foundation.',
          category: 'technical_metadata',
          evidence: ['https://domain.example/', 'https://domain.example/page-1', 'https://domain.example/page-5', 'https://domain.example/page-2'],
        },
        {
          title: 'Publishing is frequent and recent',
          detail:
            'The sitemap lists blog posts with lastmod dates of 2026-10-19, 10-16, 10-15, 10-14, 10-13, 10-09, 10-08 and 10-07, plus more than 30 author pages (/author/...). Topics include practical explainers that match likely search questions, such as "tool protocol 2026-07-28: What\'s Changing and How to Migrate", "Writing an effective PROJECT.md" and "How Does Agentic Commerce Work?".',
          category: 'content_depth_freshness',
          evidence: ['https://domain.example/page-7', 'https://domain.example/page-3'],
        },
      ],
      recommendations: [
        {
          priority: 1,
          title: 'Replace the placeholder FAQPage schema on the homepage (quick fix, high priority)',
          detail:
            'The homepage JSON-LD `FAQPage` currently says "You can create projects directly from your dashboard after signing up" and "Yes, Example AI Foundation offers a free tier with access to core features. Premium tiers are available…". These read like template text and do not describe a Example Foundation foundation. AI engines could repeat them as fact. Replace them with at least eight accurate pairs, and show the same questions and answers in a visible FAQ section. Suggested questions: What is the Example AI Foundation? Which projects does Example AI Foundation host (tool protocol, sample-agent, PROJECT.md, ETE, sample-gateway, Example Task Router)? How is Example AI Foundation governed? How does my organization become a member? How do I submit a project (including the Sandbox phase)? What is the relationship between Example AI Foundation and the Example Foundation? What is Example Credential certification? When and where is Example Agent Summit?',
          category: 'technical_metadata',
        },
        {
          priority: 2,
          title: 'Fix the truncated Projects description (quick fix)',
          detail:
            '/projects uses "Example AI Foundation supports shared technical components" as its meta description, og:description, ExamplePlatformG:description and llms.txt entry. Rewrite it as a complete sentence of 140–160 characters, for example: "Example AI Foundation hosts open protocols and open source projects for agentic AI, including tool protocol, sample-agent, PROJECT.md, ETE, sample-gateway and Example Task Router."',
          category: 'technical_metadata',
        },
        {
          priority: 3,
          title: 'Lead the homepage with the entity definition (quick fix)',
          detail:
            'The homepage H1 is "Shared tooling grows through reusable interfaces and open collaboration. So will reliable automation.", which is a slogan rather than a definition. Add the About definition sentence as visible copy just below the H1, so crawlers that read only the homepage can extract it.',
          category: 'content_answerability',
        },
        {
          priority: 4,
          title: 'Add a `## Projects` section to llms.txt (quick fix)',
          detail:
            'Give one line per hosted project, linking to its project page or repository and describing it in one sentence. Make sure no descriptions are cut off; for example, several blog summaries end mid-word, such as "…or the or". Consider moving the blog index into a separate /llms-full.txt or a capped "recent posts" list.',
          category: 'llms_txt',
        },
        {
          priority: 5,
          title: 'Add Article/BlogPosting and Person schema to blog posts (moderate effort)',
          detail:
            'In the server HTML of the blog post we checked, we saw only `WebSite` and `Organization` JSON-LD. Add `BlogPosting` with `headline`, `datePublished`, `dateModified`, `author` (linked to the /author/ page as `Person`) and `publisher`. Also add `og:image` to /about, which currently has none.',
          category: 'technical_metadata',
        },
        {
          priority: 6,
          title: 'Grow independent coverage beyond launch (ongoing content program)',
          detail:
            'Pitch trade press such as Example Engineering Journal, Example Platform Journal and Example Industry Journal on milestones like the tool protocol 2026-07-28 release, the ETE and Example Task Router additions and Example Credential certification. Create or improve a neutral ExamplePlatformC entry backed by the Example Tech Press and Example Industry Journal coverage, and encourage member companies to publish case studies that link to domain.example.',
          category: 'external_authority',
        },
      ],
      caveats: [
        'No live AI-engine tests were run with Example Assistant A, Example Assistant B, Example Assistant C, Example Assistant D or Example Search Vendor AI Overviews, and no backlink or traffic tools (Example SEO Service A, Example SEO Service B) were available. Citation and traffic claims are therefore unverified.',
        'Search findings reflect only the Example Search Service results returned during this audit. They do not prove how any engine ranks the site. domain.example/about and domain.example appeared near the top for "what is the Example AI Foundation".',
        'Large files were fetched only in part: the homepage up to 60 KB, llms.txt and sitemap.xml up to 30 KB, and /about, /projects and the blog post up to 8 KB each. Schema and body content beyond those limits, such as possible BlogPosting markup or visible FAQ text later in a page, could not be checked. We had no browser, so schema added by client-side JavaScript was not checked either.',
        '/md/about returns `x-robots-tag: noindex`. This seems intended, to avoid duplicating the HTML pages, and is not counted as a problem.',
        'LFX context was unavailable because the form supplied no LFX project scope, so no project records or metrics were read.',
        'No requester context was supplied (audience, comparison targets, priorities). The audit assumes developers, enterprise platform teams and prospective member organizations are the target audience.',
        'Example AI Lab, Example Research and Example Systems are co-founders, and the Example Foundation is the parent organization. Their announcements are counted as affiliated sources, not independent coverage.',
      ],
      sources: (
        [
          ['https://domain.example/', 'audited'],
          ['https://domain.example/page-6', 'audited'],
          ['https://domain.example/page-3', 'audited'],
          ['https://domain.example/page-7', 'audited'],
          ['https://domain.example/page-1', 'audited'],
          ['https://domain.example/page-4', 'audited'],
          ['https://domain.example/page-5', 'audited'],
          ['https://domain.example/page-2', 'audited'],
          ['https://reference-10.example/page-10', 'search'],
          ['https://reference-12.example/page-12', 'search'],
          ['https://reference-14.example/page-14', 'search'],
          ['https://reference-13.example/page-13', 'search'],
          ['https://reference-9.example/page-9', 'search'],
          ['https://reference-11.example/page-11', 'search'],
          ['https://reference-8.example/page-8', 'search'],
        ] as const
      ).map(([url, role]) => ({ url, role })),
    },
    inputs: {
      key_pages_provided: false,
      pages_audited: [
        'https://domain.example/',
        'https://domain.example/page-6',
        'https://domain.example/page-3',
        'https://domain.example/page-7',
        'https://domain.example/page-1',
        'https://domain.example/page-4',
        'https://domain.example/page-5',
        'https://domain.example/page-2',
      ],
    },
    capabilities: { web_fetch: true, web_search: true },
    intake: { completed_at: '2026-10-19T21:31:11Z', mode: 'form' },
    generated_at: '2026-10-19T21:31:11Z',
    agent: {
      identifier: 'linux-foundation~aeo-geo',
      agent_version: '2.0.0',
      prompt_manifest_sha256: '67d41d6e5322956778b06914946748073ab8090254e1db15ca883970e248b8ba',
    },
  };
}
