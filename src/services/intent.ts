/**
 * intent.ts — Generic Query Representation & Intent Parser for NECN Answer Engine.
 *
 * Deconstructs natural language queries into a canonical representation:
 * - entities: ['CSE', 'ECE', 'NECN', 'ADMISSIONS', etc.]
 * - attributes: ['HOD', 'EMAIL', 'PHONE', 'FACILITIES', 'ADMISSION_PROCEDURE', etc.]
 * - questionType: 'direct_fact' | 'list' | 'procedure' | 'descriptive' | 'multi_part' | 'multi_entity' | 'multi_attribute' | 'ambiguous' | 'temporal' | 'contact'
 * - temporalScope: 'current' | 'past' | 'future'
 * - expectedAnswerForm: 'person_name' | 'email_address' | 'phone_number' | 'item_list' | 'procedural_steps' | 'descriptive_text' | 'address_text' | 'clarification_needed'
 */

export type EntityType =
  | 'CSE' | 'ECE' | 'EEE' | 'CIVIL' | 'MECH' | 'MCA' | 'MBA' | 'FED' | 'CSM'
  | 'PRINCIPAL' | 'ADMISSIONS' | 'NECN';

export type AttributeType =
  | 'HOD' | 'PRINCIPAL' | 'EMAIL' | 'PHONE' | 'ADDRESS'
  | 'FACILITIES' | 'LIBRARY' | 'SPORTS' | 'TRANSPORT' | 'CANTEEN' | 'HOSTEL'
  | 'ADMISSION_PROCEDURE' | 'ADMISSION_REQUIREMENTS' | 'ADMISSION_DOCUMENTS'
  | 'COURSES' | 'PROGRAMS' | 'FACULTY' | 'VISION' | 'MISSION'
  | 'ATTENDANCE' | 'EXAMINATION_REGULATIONS';

export type QuestionType =
  | 'direct_fact' | 'list' | 'procedure' | 'descriptive'
  | 'multi_entity' | 'multi_attribute' | 'ambiguous' | 'temporal' | 'contact';

export type ExpectedAnswerForm =
  | 'person_name' | 'email_address' | 'phone_number' | 'item_list'
  | 'procedural_steps' | 'descriptive_text' | 'address_text' | 'clarification_needed';

export interface SubQuery {
  entity: EntityType;
  attribute: AttributeType;
  rawQuery: string;
}

export interface GenericQueryRepresentation {
  rawQuery: string;
  normalizedQuery: string;
  entities: EntityType[];
  attributes: AttributeType[];
  questionType: QuestionType;
  temporalScope: 'current' | 'past' | 'future';
  temporalYear?: number;
  expectedAnswerForm: ExpectedAnswerForm;
  constraints: Record<string, string>;
  isAmbiguous: boolean;
  ambiguousAttribute?: AttributeType;
  subQueries: SubQuery[];
}

const DEPT_MAP: Record<string, EntityType> = {
  'cse': 'CSE', 'computer science': 'CSE', 'computer science engineering': 'CSE', 'c.s.e': 'CSE',
  'ece': 'ECE', 'electronics': 'ECE', 'electronics communication': 'ECE', 'electronics & communication': 'ECE', 'e.c.e': 'ECE',
  'eee': 'EEE', 'electrical': 'EEE', 'electrical electronics': 'EEE', 'electrical & electronics': 'EEE', 'e.e.e': 'EEE',
  'civil': 'CIVIL', 'civil engineering': 'CIVIL',
  'mech': 'MECH', 'mechanical': 'MECH', 'mechanical engineering': 'MECH',
  'mca': 'MCA', 'master of computer applications': 'MCA',
  'mba': 'MBA', 'master of business administration': 'MBA',
  'fed': 'FED', 'freshman engineering': 'FED',
  'csm': 'CSM', 'ai & ml': 'CSM', 'ai/ml': 'CSM', 'artificial intelligence': 'CSM'
};

export function parseQueryRepresentation(rawQuery: string, _context?: string): GenericQueryRepresentation {
  const lower = rawQuery.toLowerCase().trim();

  // Normalize common paraphrases
  const normalized = lower
    .replace(/\b(who\s+heads?|who\s+leads?|heading|head\s+of\s+department|department\s+head|current\s+head|currently\s+leading)\b/g, 'hod')
    .replace(/\b(who\s+are\s+the\s+department\s+heads|who\s+are\s+the\s+hods|all\s+department\s+heads|all\s+hods|list\s+of\s+hods|department\s+heads\s+list)\b/g, 'department_heads_list')
    .replace(/\b(who\s+can\s+(?:i\s+)?contact\s+for\s+admissions?|who\s+handles?\s+admissions?|how\s+(?:do\s+i|to)\s+contact\s+the?\s+admissions?\s+office|where\s+should\s+i\s+contact\s+for\s+admissions?|admission\s+contact|admissions?\s+enquiry|admission\s+coordinator)\b/g, 'admission contact')
    .replace(/\b(how\s+do\s+i\s+apply|how\s+can\s+i\s+get\s+admission|how\s+to\s+apply|admission\s+process|admission\s+steps)\b/g, 'admission procedure')
    .replace(/\b(college\s+address|where\s+is\s+necn|location\s+of\s+necn|where\s+is\s+the\s+college)\b/g, 'official necn address');

  // 1. Detect Temporal Scope
  let temporalScope: 'current' | 'past' | 'future' = 'current';
  let temporalYear: number | undefined = undefined;

  const yearMatch = normalized.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    temporalYear = parseInt(yearMatch[1], 10);
    if (temporalYear < 2024) temporalScope = 'past';
    else if (temporalYear > 2026) temporalScope = 'future';
  } else if (/\b(was|were|previously|former|past|historically|in the past)\b/.test(normalized)) {
    temporalScope = 'past';
  } else if (/\b(will be|future|next year|in 20\d{2})\b/.test(normalized)) {
    temporalScope = 'future';
  }

  // 2. Detect Entities
  const entitiesSet = new Set<EntityType>();
  for (const [alias, code] of Object.entries(DEPT_MAP)) {
    if (normalized.includes(alias)) {
      entitiesSet.add(code);
    }
  }

  if (/\b(principal|head of institution)\b/.test(normalized)) {
    entitiesSet.add('PRINCIPAL');
  }
  if (/\b(admission|admissions|apply|entrance|eapcet|icet)\b/.test(normalized)) {
    entitiesSet.add('ADMISSIONS');
  }
  if (entitiesSet.size === 0) {
    entitiesSet.add('NECN');
  }

  const entities = Array.from(entitiesSet);

  // 3. Detect Attributes
  const attributesSet = new Set<AttributeType>();
  if (/\b(hod|head|department_heads_list)\b/.test(normalized)) attributesSet.add('HOD');
  if (/\b(principal)\b/.test(normalized)) attributesSet.add('PRINCIPAL');
  if (/\b(email|e-?mail)\b/.test(normalized)) attributesSet.add('EMAIL');
  if (/\b(phone|telephone|mobile|contact number|call)\b/.test(normalized)) attributesSet.add('PHONE');
  if (/\b(address|location|where is|route map|pincode)\b/.test(normalized)) attributesSet.add('ADDRESS');
  if (/\b(facility|facilities|amenities|infrastructure)\b/.test(normalized)) attributesSet.add('FACILITIES');
  if (/\b(library)\b/.test(normalized)) attributesSet.add('LIBRARY');
  if (/\b(sports|games|athletics)\b/.test(normalized)) attributesSet.add('SPORTS');
  if (/\b(transport|bus|buses|conveyance)\b/.test(normalized)) attributesSet.add('TRANSPORT');
  if (/\b(canteen|food)\b/.test(normalized)) attributesSet.add('CANTEEN');
  if (/\b(hostel|accommodation)\b/.test(normalized)) attributesSet.add('HOSTEL');
  if (/\b(admission contact)\b/.test(normalized)) attributesSet.add('PHONE');
  if (/\b(admission procedure|how to apply|admission process|application process)\b/.test(normalized)) attributesSet.add('ADMISSION_PROCEDURE');
  if (/\b(admission requirements|eligibility|qualification|marks required)\b/.test(normalized)) attributesSet.add('ADMISSION_REQUIREMENTS');
  if (/\b(documents required|certificates required|documents|certificates)\b/.test(normalized)) attributesSet.add('ADMISSION_DOCUMENTS');
  if (/\b(courses|course|branches|specializations)\b/.test(normalized)) attributesSet.add('COURSES');
  if (/\b(program|programs|degrees|undergraduate|postgraduate|b\.tech|m\.tech|mba|mca)\b/.test(normalized)) attributesSet.add('PROGRAMS');
  if (/\b(faculty|staff|professors|teachers|lecturers)\b/.test(normalized)) attributesSet.add('FACULTY');
  if (/\b(vision)\b/.test(normalized)) attributesSet.add('VISION');
  if (/\b(mission)\b/.test(normalized)) attributesSet.add('MISSION');
  if (/\b(attendance|condonation|percentage)\b/.test(normalized)) attributesSet.add('ATTENDANCE');
  if (/\b(examination|examinations|exam regulations|academic regulations|regulation|regulations)\b/.test(normalized)) attributesSet.add('EXAMINATION_REGULATIONS');

  const attributes = Array.from(attributesSet);

  // 4. Ambiguity Detection
  let isAmbiguous = false;
  let ambiguousAttribute: AttributeType | undefined = undefined;

  // Question asks for a single department HOD without specifying which department,
  // BUT NOT if asking for all department heads / list of HODs or explicit admission queries!
  const deptEntities = entities.filter(e => e !== 'NECN' && e !== 'ADMISSIONS');
  const isAllHodsListQuery = normalized.includes('department_heads_list') || /\b(department heads|heads of department|all hods)\b/.test(normalized);
  
  if (attributes.includes('HOD') && deptEntities.length === 0 && !isAllHodsListQuery) {
    isAmbiguous = true;
    ambiguousAttribute = 'HOD';
  } else if (attributes.includes('PHONE') && entities.includes('NECN') && deptEntities.length === 0 && !entities.includes('ADMISSIONS') && !normalized.includes('admission')) {
    isAmbiguous = true;
    ambiguousAttribute = 'PHONE';
  } else if (attributes.includes('COURSES') && entities.includes('NECN') && deptEntities.length === 0 && !normalized.includes('program')) {
    isAmbiguous = true;
    ambiguousAttribute = 'COURSES';
  }

  // 5. Question Type Classification
  let questionType: QuestionType = 'direct_fact';
  let expectedAnswerForm: ExpectedAnswerForm = 'descriptive_text';

  if (isAmbiguous) {
    questionType = 'ambiguous';
    expectedAnswerForm = 'clarification_needed';
  } else if (temporalScope !== 'current') {
    questionType = 'temporal';
  } else if (deptEntities.length >= 2) {
    questionType = 'multi_entity';
  } else if (attributes.length >= 2) {
    questionType = 'multi_attribute';
  } else if (attributes.includes('ADMISSION_PROCEDURE')) {
    questionType = 'procedure';
    expectedAnswerForm = 'procedural_steps';
  } else if (attributes.includes('FACILITIES') || attributes.includes('PROGRAMS') || attributes.includes('COURSES') || attributes.includes('FACULTY') || attributes.includes('ADMISSION_DOCUMENTS')) {
    questionType = 'list';
    expectedAnswerForm = 'item_list';
  } else if (attributes.includes('EMAIL')) {
    questionType = 'contact';
    expectedAnswerForm = 'email_address';
  } else if (attributes.includes('PHONE')) {
    questionType = 'contact';
    expectedAnswerForm = 'phone_number';
  } else if (attributes.includes('ADDRESS')) {
    questionType = 'contact';
    expectedAnswerForm = 'address_text';
  } else if (attributes.includes('HOD') || attributes.includes('PRINCIPAL')) {
    questionType = 'direct_fact';
    expectedAnswerForm = 'person_name';
  }

  // 6. Multi-part SubQueries De-composition
  const subQueries: SubQuery[] = [];
  if (questionType === 'multi_entity') {
    const attr = attributes[0] || 'HOD';
    for (const ent of deptEntities) {
      subQueries.push({ entity: ent, attribute: attr, rawQuery: `${ent} ${attr}` });
    }
  } else if (questionType === 'multi_attribute') {
    const ent = deptEntities[0] || entities[0] || 'NECN';
    for (const attr of attributes) {
      subQueries.push({ entity: ent, attribute: attr, rawQuery: `${ent} ${attr}` });
    }
  } else {
    subQueries.push({
      entity: deptEntities[0] || entities[0] || 'NECN',
      attribute: attributes[0] || 'PROGRAMS',
      rawQuery
    });
  }

  return {
    rawQuery,
    normalizedQuery: normalized,
    entities,
    attributes,
    questionType,
    temporalScope,
    temporalYear,
    expectedAnswerForm,
    constraints: {},
    isAmbiguous,
    ambiguousAttribute,
    subQueries
  };
}

export type IntentTag =
  | 'faculty' | 'department_head' | 'courses' | 'admissions' | 'facilities'
  | 'placements' | 'academics' | 'counseling' | 'regulations' | 'sports'
  | 'pdf' | 'general';

export function detectIntent(query: string): { tag: IntentTag; confidence: number } {
  const rep = parseQueryRepresentation(query);
  if (rep.attributes.includes('HOD')) return { tag: 'department_head', confidence: 0.95 };
  if (rep.attributes.includes('FACULTY')) return { tag: 'faculty', confidence: 0.95 };
  if (rep.attributes.includes('ADMISSION_PROCEDURE') || rep.attributes.includes('ADMISSION_REQUIREMENTS')) return { tag: 'admissions', confidence: 0.95 };
  if (rep.attributes.includes('FACILITIES')) return { tag: 'facilities', confidence: 0.95 };
  if (rep.attributes.includes('COURSES') || rep.attributes.includes('PROGRAMS')) return { tag: 'courses', confidence: 0.95 };
  if (rep.attributes.includes('EXAMINATION_REGULATIONS') || rep.attributes.includes('ATTENDANCE')) return { tag: 'regulations', confidence: 0.95 };
  if (/\b(placement|placements|recruitment|career)\b/i.test(query)) return { tag: 'placements', confidence: 0.9 };
  if (/\b(academic|syllabus|calendar|examination)\b/i.test(query)) return { tag: 'academics', confidence: 0.9 };
  if (/\b(sports?|games?)\b/i.test(query)) return { tag: 'sports', confidence: 0.9 };
  if (/\b(counsel(?:ing|ling))\b/i.test(query)) return { tag: 'counseling', confidence: 0.9 };
  return { tag: 'general', confidence: 0.5 };
}

export function applyIntentBonus(intent: IntentTag, hit: any): number {
  if (intent === 'general') return 0;
  const haystack = `${hit.title || ''} ${hit.section || ''} ${hit.department || ''} ${hit.url || ''}`.toLowerCase();
  const terms: Record<Exclude<IntentTag, 'general'>, RegExp> = {
    faculty: /faculty|staff/,
    department_head: /department|academic.leadership|hod/,
    courses: /course|programme|program|admission|academic/,
    admissions: /admission|eligib|apply/,
    facilities: /facilit|library|hostel|infrastructure|campus/,
    placements: /placement|career|training/,
    academics: /academic|syllabus|calendar|examination/,
    counseling: /counsel|career/,
    regulations: /regulation|academic/,
    sports: /sport|game|physical/,
    pdf: /pdf/
  };
  return terms[intent].test(haystack) ? 35 : -25;
}
