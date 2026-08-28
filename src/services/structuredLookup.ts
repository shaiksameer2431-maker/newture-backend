/**
 * structuredLookup.ts — Direct structured-table answering for faculty/department
 * queries. Queried BEFORE falling through to website_chunks retrieval + LLM.
 *
 * Uses better-sqlite3 synchronous API via getDb(), matching the rest of the
 * codebase. Returns null when no structured answer is possible, allowing the
 * caller to continue the normal pipeline.
 */

import { getDb } from '../database/db.js';

export interface StructuredAnswer {
  answer: string;
  source: 'Structured College Records';
  table: 'faculty' | 'departments';
  confidence: number;
  isConfident: true;
  lastUpdated: string;
  matchedRuleId: null;
  matchedQuestion: null;
}

// Maps common aliases to the `departments.code` column values.
// Extend if the DB uses different codes.
const DEPT_ALIASES: Record<string, string> = {
  cse: 'CSE', 'computer science': 'CSE', 'computer science engineering': 'CSE',
  ece: 'ECE', 'electronics': 'ECE', 'electronics communication': 'ECE', 'electronics and communication': 'ECE',
  eee: 'EEE', 'electrical': 'EEE', 'electrical electronics': 'EEE', 'electrical and electronics': 'EEE',
  mech: 'MECH', mechanical: 'MECH', 'mechanical engineering': 'MECH',
  civil: 'CIVIL', 'civil engineering': 'CIVIL',
  it: 'IT', 'information technology': 'IT',
  mca: 'MCA', 'master of computer applications': 'MCA',
  mba: 'MBA', 'master of business administration': 'MBA',
  fed: 'FED', 'freshman engineering': 'FED',
};

type StructuredIntent =
  | 'department_hod'
  | 'department_contact'
  | 'department_info'
  | 'faculty_list'
  | 'faculty_lookup'
  | 'principal'
  | null;

function classifyStructuredIntent(query: string): StructuredIntent {
  const q = query.toLowerCase();

  if (/\b(principal|principal director)\b/.test(q)) return 'principal';
  if (/\b(hod|head of department|head of the department|department head|who\s+heads?)\b/.test(q)) return 'department_hod';
  if (/\b(contact|phone|telephone|mobile|number|email|e-?mail)\b/.test(q) && /\b(department|dept)\b/.test(q)) return 'department_contact';
  if (/\b(list|faculty|staff|professors?|teachers?|lecturers?)\b/.test(q) && /\b(department|dept|cse|ece|eee|mech|civil|it|mca|mba|fed)\b/.test(q)) return 'faculty_list';
  if (/\b(who\s+is|contact\s+of|email\s+of|phone\s+of)\b/.test(q) && /\b(prof|dr|mr|ms|mrs)\b/.test(q)) return 'faculty_lookup';

  return null;
}

function resolveDeptCode(query: string): string | null {
  const lower = query.toLowerCase();
  // Try longest aliases first to avoid partial matches (e.g. "computer science engineering" before "computer")
  const sorted = Object.entries(DEPT_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, code] of sorted) {
    if (lower.includes(alias)) return code;
  }
  return null;
}

/**
 * Attempt to answer the query from `faculty` / `departments` tables.
 * Returns null if the intent doesn't apply or no matching rows exist —
 * the caller should continue down the normal pipeline, NOT return "not found".
 */
export function tryStructuredLookup(query: string): StructuredAnswer | null {
  const intent = classifyStructuredIntent(query);
  if (!intent) return null;

  const db = getDb();
  const now = new Date().toISOString();

  switch (intent) {
    case 'principal': {
      return null;
    }

    case 'department_hod': {
      const deptCode = resolveDeptCode(query);
      if (!deptCode) return null;

      const row = db.prepare(
        `SELECT name, hod, contact_number, email FROM departments WHERE upper(code) = ? LIMIT 1`
      ).get(deptCode) as any;
      if (!row?.hod) return null;

      return {
        answer: `The Head of Department (HOD) for ${row.name || deptCode} is ${row.hod}${row.contact_number ? ` (Contact: ${row.contact_number})` : ''}.`,
        source: 'Structured College Records', table: 'departments',
        confidence: 98, isConfident: true, lastUpdated: now,
        matchedRuleId: null, matchedQuestion: null,
      };
    }

    case 'department_contact': {
      const deptCode = resolveDeptCode(query);
      if (!deptCode) return null;

      const row = db.prepare(
        `SELECT name, contact_number, email, location FROM departments WHERE upper(code) = ? LIMIT 1`
      ).get(deptCode) as any;
      if (!row || (!row.contact_number && !row.email)) return null;

      const parts: string[] = [];
      if (row.contact_number) parts.push(`Phone: ${row.contact_number}`);
      if (row.email) parts.push(`Email: ${row.email}`);
      if (row.location) parts.push(`Location: ${row.location}`);

      return {
        answer: `Contact details for the ${row.name || deptCode} department — ${parts.join(' | ')}.`,
        source: 'Structured College Records', table: 'departments',
        confidence: 97, isConfident: true, lastUpdated: now,
        matchedRuleId: null, matchedQuestion: null,
      };
    }

    case 'faculty_list': {
      const deptCode = resolveDeptCode(query);
      if (!deptCode) return null;

      const rows = db.prepare(
        `SELECT name, designation FROM faculty WHERE upper(department) = ? ORDER BY designation, name`
      ).all(deptCode) as any[];
      if (!rows?.length) return null;

      const lines = rows.map(r => `• ${r.name}${r.designation ? ` — ${r.designation}` : ''}`);

      return {
        answer: `Faculty in the ${deptCode} department:\n\n${lines.join('\n')}`,
        source: 'Structured College Records', table: 'faculty',
        confidence: 96, isConfident: true, lastUpdated: now,
        matchedRuleId: null, matchedQuestion: null,
      };
    }

    case 'faculty_lookup': {
      const nameMatch = query.match(
        /(?:prof(?:essor)?\.?\s+|dr\.?\s+|mr\.?\s+|ms\.?\s+|mrs\.?\s+)([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,3})/i
      );
      if (!nameMatch) return null;
      const candidateName = nameMatch[1];

      const row = db.prepare(
        `SELECT name, designation, department, email, contact FROM faculty WHERE name LIKE ? LIMIT 1`
      ).get(`%${candidateName}%`) as any;
      if (!row) return null;

      return {
        answer: `${row.name} is ${row.designation || 'a faculty member'} in the ${row.department || 'college'} department.${row.email ? ` Email: ${row.email}.` : ''}${row.contact ? ` Phone: ${row.contact}.` : ''}`,
        source: 'Structured College Records', table: 'faculty',
        confidence: 95, isConfident: true, lastUpdated: now,
        matchedRuleId: null, matchedQuestion: null,
      };
    }

    default:
      return null;
  }
}
