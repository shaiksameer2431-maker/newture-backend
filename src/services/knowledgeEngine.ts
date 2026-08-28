import { getDb } from "../database/db.js";
import { searchWebsiteKnowledge, WebsiteSearchResult } from "./websiteSearch.js";
import { tryStructuredLookup } from "./structuredLookup.js";
import { parseQueryRepresentation, GenericQueryRepresentation, SubQuery } from "./intent.js";
import { generateGroundedAnswer, SemanticChunk } from "./semanticRag.js";

export interface EngineSearchResult {
  answer: string;
  source: string;
  pageTitle: string;
  website: string;
  confidence: number;
  lastUpdated: string;
  isConfident: boolean;
  matchedRuleId?: string | null;
  matchedQuestion?: string | null;
  url?: string;
  category?: string;
  chunkId?: string;
  grounded?: boolean;
  sources?: Array<{ title: string; url: string; pageId?: string | null; chunkId?: string | null }>;
}

const SAFE_NOT_FOUND = "I couldn't verify that information from the available official NECN sources.";

async function executeSingleSubQuery(sub: SubQuery, queryRep: GenericQueryRepresentation, chatbotLanguage = "English"): Promise<EngineSearchResult | null> {
  const queryClean = sub.rawQuery.toLowerCase().trim();
  const db = getDb();

  // 1. Check structured DB tables (departments, faculty)
  const structuredHit = tryStructuredLookup(sub.rawQuery);
  if (structuredHit) {
    return {
      answer: structuredHit.answer,
      source: structuredHit.source,
      pageTitle: structuredHit.table === 'departments' ? 'Departments' : 'Faculty',
      website: 'Narayana Engineering College',
      confidence: structuredHit.confidence,
      lastUpdated: structuredHit.lastUpdated,
      isConfident: true,
      matchedRuleId: null,
      matchedQuestion: null,
      sources: [{ title: 'Structured College Records', url: 'https://necn.ac.in/departments.php' }]
    };
  }

  // 2. Search Website Knowledge Base (FTS5 + Vector Embeddings)
  const searchResults = await searchWebsiteKnowledge(sub.rawQuery, 5, chatbotLanguage);
  if (searchResults && searchResults.length > 0 && searchResults[0].isConfident) {
    const top = searchResults[0];
    const uniqueSourcesMap = new Map<string, { title: string; url: string; pageId?: string | null; chunkId?: string | null }>();
    for (const s of searchResults) {
      if (s.url && !uniqueSourcesMap.has(s.url)) {
        let title = s.pageTitle || 'NECN Official Page';
        if (title === 'NEC Nellore' || title === 'NECN Website' || title === 'NEC Nellore ') {
          if (s.url.includes('prinicpal-desk')) title = "Principal's Profile";
          else if (s.url.includes('admission')) title = "Admissions & Procedure";
          else if (s.url.includes('contact')) title = "Contact Us";
          else if (s.url.includes('department') || s.url.includes('academic-leadership')) title = "Academic Leadership";
          else if (s.url.includes('facilities') || s.url.includes('facility')) title = "Campus Facilities";
          else if (s.url.includes('rti')) title = "Official Records";
        }
        uniqueSourcesMap.set(s.url, { title, url: s.url, pageId: null, chunkId: s.chunkId });
      }
    }
    const sources = Array.from(uniqueSourcesMap.values());

    return {
      answer: top.answer,
      source: top.source,
      pageTitle: sources[0]?.title || top.pageTitle,
      website: top.website,
      confidence: top.confidence,
      lastUpdated: top.lastUpdated,
      isConfident: true,
      matchedRuleId: null,
      matchedQuestion: null,
      url: sources[0]?.url || top.url,
      category: top.category,
      chunkId: top.chunkId,
      grounded: true,
      sources
    };
  }

  return null;
}

export async function findBestStrictAnswer(query: string, chatbotLanguage = "English", conversationContext?: string): Promise<EngineSearchResult | null> {
  const queryRep = parseQueryRepresentation(query, conversationContext);
  const db = getDb();
  const now = new Date().toISOString();

  // --------------------------------------------------
  // 1. TEMPORAL SAFETY GATE
  // --------------------------------------------------
  // If user asks for historical (e.g. 1990) or future (e.g. 2040) facts,
  // check if DB contains explicit evidence for that year.
  // Current database evidence covers present records (2024-2026).
  if (queryRep.temporalScope === 'past' || queryRep.temporalScope === 'future') {
    if (queryRep.temporalYear && (queryRep.temporalYear < 2020 || queryRep.temporalYear > 2026)) {
      // Search DB to see if any chunk mentions this explicit year
      const yearStr = String(queryRep.temporalYear);
      const row = db.prepare(`SELECT count(*) n FROM website_chunks c JOIN website_pages p ON p.id=c.page_id WHERE p.is_active=1 AND c.content LIKE ?`).get(`%${yearStr}%`) as any;
      if (!row || row.n === 0) {
        console.log(`[CHAT PIPELINE] TEMPORAL_REJECTED: No stored evidence for year ${yearStr}`);
        return null;
      }
    } else if (queryRep.temporalScope === 'past' && !queryRep.temporalYear) {
      console.log(`[CHAT PIPELINE] TEMPORAL_REJECTED: Historical query unsupported without explicit stored records`);
      return null;
    }
  }

  // --------------------------------------------------
  // 2. AMBIGUITY GATE
  // --------------------------------------------------
  // If user asks "Who is the HOD?", "What is the phone number?", "What courses are available?"
  // without specifying the target department/entity, prompt for clarification.
  if (queryRep.isAmbiguous) {
    let text = "";
    if (queryRep.ambiguousAttribute === 'HOD') {
      text = "Which department's HOD are you asking about? (e.g., CSE, ECE, EEE, Civil, Mechanical, MBA, MCA)";
    } else if (queryRep.ambiguousAttribute === 'PHONE') {
      text = "Which department or office phone number are you looking for? (e.g., Principal's Office, Admissions, CSE, ECE)";
    } else if (queryRep.ambiguousAttribute === 'COURSES') {
      text = "Are you asking about Undergraduate (B.Tech) or Post-Graduate (M.Tech, MBA, MCA) courses, or a specific department's courses?";
    } else {
      text = "Could you please specify which department or program you are inquiring about?";
    }

    return {
      answer: text,
      source: "Knowledge Engine (Clarification Required)",
      pageTitle: "Clarification Needed",
      website: "Narayana Engineering College",
      confidence: 100,
      lastUpdated: now,
      isConfident: true
    };
  }

  // --------------------------------------------------
  // 3. MULTI-ENTITY / MULTI-ATTRIBUTE DE-COMPOSITION
  // --------------------------------------------------
  if (queryRep.questionType === 'multi_entity' || queryRep.questionType === 'multi_attribute') {
    const subResults: Array<{ sub: SubQuery; result: EngineSearchResult | null }> = [];

    for (const sub of queryRep.subQueries) {
      const res = await executeSingleSubQuery(sub, queryRep, chatbotLanguage);
      subResults.push({ sub, result: res });
    }

    const verified = subResults.filter(r => r.result !== null);
    if (verified.length > 0) {
      const combinedLines: string[] = [];
      const sources: Array<{ title: string; url: string }> = [];

      for (const item of subResults) {
        if (item.result) {
          combinedLines.push(`• ${item.sub.entity} ${item.sub.attribute}: ${item.result.answer.replace(/^According to [^:]+:\s*/i, '')}`);
          if (item.result.sources) {
            sources.push(...item.result.sources.map(s => ({ title: s.title, url: s.url })));
          } else if (item.result.url) {
            sources.push({ title: item.result.pageTitle || 'NECN Official Website', url: item.result.url });
          }
        } else {
          combinedLines.push(`• ${item.sub.entity} ${item.sub.attribute}: Could not be verified from available official NECN sources.`);
        }
      }

      return {
        answer: combinedLines.join('\n\n'),
        source: "NECN Official Website",
        pageTitle: "Multi-Part Query Response",
        website: "Narayana Engineering College, Nellore",
        confidence: 95,
        lastUpdated: now,
        isConfident: true,
        sources
      };
    } else {
      return null;
    }
  }

  // --------------------------------------------------
  // 4. SINGLE QUERY PROCESSING
  // --------------------------------------------------
  const singleSub: SubQuery = {
    entity: queryRep.entities[0] || 'NECN',
    attribute: queryRep.attributes[0] || 'PROGRAMS',
    rawQuery: queryRep.normalizedQuery
  };

  return executeSingleSubQuery(singleSub, queryRep, chatbotLanguage);
}

export async function searchKnowledgeBase(query: string, chatbotLanguage = "English"): Promise<EngineSearchResult[]> {
  const result = await findBestStrictAnswer(query, chatbotLanguage);
  return result ? [result] : [];
}

export async function parallelMultiSourceSearch(query: string, chatbotLanguage = "English"): Promise<EngineSearchResult[]> {
  return searchKnowledgeBase(query, chatbotLanguage);
}
