/**
 * contentCleaner.ts — DOM-aware HTML cleaner + plaintext cleaner +
 * chrome-block detector + section/department detector.
 *
 * Two modes:
 *   1. cleanHtml(input)  — used by fresh crawls. NECN pages contain the
 *      mega-menu text inside the page body; this path strips structural
 *      chrome by class/id and converts HTML to plaintext with structural
 *      markers.
 *   2. cleanPlaintext(input, opts) — used by the rebuild script. The
 *      existing DB content is plaintext with the chrome header. We remove
 *      the chrome by (a) literal fingerprint lines, (b) block-frequency
 *      matching using a precomputed chrome Map, (c) explicit prefix cut.
 *
 * Neither path fabricates content. They only remove chrome and tag known
 * strong headings for the chunker.
 */

import crypto from 'crypto';

// ---------- public types ----------
export interface CleanPageOptions {
  source?: 'crawler' | 'rebuild';
  minChromeOccurrences?: number;
  chromeMap?: Map<string, ChromeBlock>;
}
export interface SectionMetadata {
  section: string | null;
  department: string | null;
  urlSlug: string;
}
export interface ChromeBlock { hash: string; text: string; pageCount: number; }

// ---------- known NECN mega-menu fingerprints ----------
const KNOWN_CHROME_FINGERPRINTS: string[] = [
  'NEC Nellore | Narayana Engineering College',
  '💳 Online Fee Payment',
  '📝 Online Application',
  'EAPCET - NARN | PGECET - NARN1 | ICET - NARN',
  '• HOME • About Us • • • Vision and Mission',
  'Anti Ragging Cell • Equal Opportunity Cell',
  'Internal Complaint Committee',
  'Grievance Redressal Committee (Institution Level)',
  'Socio-Economically Disadavantage Group cell (SEDG)',
  'Facilities For Differently-abled',
  "Womens Grievance Redressal",
  '• NIRF • AICTE Mandatory Disclosure • RTI',
  'AICTE Feedback • Online',
  'Feedback/Grievances',
  'Income & Expenditure',
  'Code of Conduct • Core',
  'Values • Cells &',
  'Committees • Innovation Cell • MOUs',
  'Moodle Server • Reach Us',
  'Locate Us &copy; Narayana Engineering College - All Rights',
  'Reserved. • Sitemap • Contact',
  'Facebook • YouTube • Instagram • WhatsApp • LinkedIn'
];

const HEADING_HINTS = [
  /^(Vision and Mission|PEO|PO|PSO|Faculty|Facilities|Achievements|Placements|CO|Laboratories|Contact Us|About (the )?Department|Quick Links|Sports|NSS|NCC|Guest Lectures|Seminars|Workshops|News|Syllabus|MOU|Memorandum of Understanding|Sponsored Projects|Industry|Collaboration|Career|Gallery|Committee|Constitution|Rules|Regulations|Code of Ethics|Code of Conduct|Patent|Publication|Outreach|Programmes|Programmes Offered|Admission|Departments|History)\s*$/im
];

// ---------- HTML cleaning ----------
const NAV_SELECTORS: RegExp[] = [
  /<nav\b[^>]*>[\s\S]*?<\/nav>/gi,
  /<header\b[^>]*>[\s\S]*?<\/header>/gi,
  /<footer\b[^>]*>[\s\S]*?<\/footer>/gi,
  /<aside\b[^>]*>[\s\S]*?<\/aside>/gi,
  /<form\b[^>]*>[\s\S]*?<\/form>/gi,
];

// Replaces regex nesting bugs by properly balancing brackets
function stripNavBlocks(html: string): string {
  const triggers = [
    'mega-menu', 'main-menu', 'nav-bar', 'navbar', 'navmenu', 'nav_menu', 'top-bar', 'topbar',
    'side-menu', 'sidemenu', 'breadcrumb', 'breadcrumbs', 'bread-crumb', 'footer-wrap',
    'footer-wrapper', 'footer-bar', 'site-footer', 'page-footer', 'skip-link', 'cookie-bar',
    'cookie-notice', 'popup', 'modal', 'newsletter', 'social-bar', 'back-to-top', 'skip-nav',
    'quick-links', 'important-links', 'quick_link', 'header-wrap', 'header-bar', 'menu-bar',
    'main-nav', 'primary-menu', 'secondary-menu', 'footer-nav', 'footer-menu', 'sidebar',
    'side-nav', 'off-canvas', 'mobile-menu', 'hamburger', 'hidden-header'
  ];

  let result = html;
  let changed = true;

  while (changed) {
    changed = false;
    let matchIndex = -1;

    // Find the first <div> or <ul> that has a matching trigger class
    const divUlRegex = /<(div|ul)\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:(?:mega-?menu|main-menu|nav-bar|navbar|navmenu|nav_menu|top-bar|topbar|side-menu|sidemenu|breadcrumb|breadcrumbs|bread-crumb|footer-wrap|footer-wrapper|footer-bar|site-footer|page-footer|skip-link|cookie-bar|cookie-notice|popup|modal|newsletter|social-bar|back-to-top|skip-nav|quick-links|important-links|quick_link|header-wrap|header-bar|menu-bar|main-nav|primary-menu|secondary-menu|footer-nav|footer-menu|sidebar|side-nav|off-canvas|mobile-menu|hamburger|hidden-header|footer-links|footer_nav|top-menu))\b[^"']*["'][^>]*>/i;
    
    const match = divUlRegex.exec(result);
    if (!match) break;

    const tag = match[1].toLowerCase();
    const startIdx = match.index;
    let depth = 1;
    let currIdx = startIdx + match[0].length;
    
    // Fast forward to balance tags
    while (depth > 0 && currIdx < result.length) {
      const openIdx = result.indexOf(`<${tag}`, currIdx);
      const closeIdx = result.indexOf(`</${tag}>`, currIdx);
      
      if (closeIdx === -1) break; // Malformed HTML
      
      if (openIdx !== -1 && openIdx < closeIdx) {
        // It's another opening tag, check if it's actually `<tag ` or `<tag>`
        const nextChar = result[openIdx + tag.length + 1];
        if (nextChar === ' ' || nextChar === '>' || nextChar === '\n' || nextChar === '\t') {
           depth++;
        }
        currIdx = openIdx + 1;
      } else {
        depth--;
        currIdx = closeIdx + `</${tag}>`.length;
      }
    }

    if (depth === 0) {
      result = result.substring(0, startIdx) + ' ' + result.substring(currIdx);
      changed = true;
    } else {
      // Malformed, break to avoid infinite loop
      break;
    }
  }

  return result;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function cleanHtml(html: string, opts: CleanPageOptions = {}): string {
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ');

  // First, try to extract page-content div (NECN pattern)
  // Extract everything from page-content start until we hit a major section boundary
  const pageContentStartMatch = body.match(/<div[^>]*class="[^"]*page-content[^"]*"[^>]*>/i);
  if (pageContentStartMatch) {
    const startIndex = body.indexOf(pageContentStartMatch[0]);
    const afterStart = body.slice(startIndex + pageContentStartMatch[0].length);
    
    // Look for major section boundaries that would indicate the end of page-content
    // Common patterns: footer, sidebar end, new section at same level
    const endPatterns = [
      /<footer\b/i,
      /<div[^>]*class="[^"]*footer[^"]*"[^>]*>/i,
      /<div[^>]*class="[^"]*sidebar[^"]*"[^>]*>/i,
      /<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/i, // Multiple closing divs suggesting end of section
    ];
    
    let endIndex = afterStart.length;
    for (const pattern of endPatterns) {
      const match = afterStart.match(pattern);
      if (match && match.index < endIndex) {
        endIndex = match.index;
      }
    }
    
    // If we found a reasonable end, extract that portion
    if (endIndex < afterStart.length - 100) {
      body = afterStart.slice(0, endIndex);
    } else {
      // Fallback: just take a large chunk (assume page-content is significant)
      body = afterStart.slice(0, Math.min(afterStart.length, 15000));
    }
  } else {
    // Fallback: strip navigation using bracket matcher
    for (const re of NAV_SELECTORS) body = body.replace(re, ' ');
    body = stripNavBlocks(body);
    
    // Try main/article tags
    const main = body.match(/<(?:main|article)\b[^>]*>[\s\S]*?<\/(?:main|article)>/gi);
    if (main?.length) body = main.join('\n');
  }

  // Preserve iframe source links as text markers before stripping them
  body = body.replace(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/iframe>/gi, (_, src) => {
    return `\n[Embedded Document: ${src}]\n`;
  });
  body = body.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, ' ');

  // Handle Bootstrap accordions: extract all panel-body content regardless of collapse state
  // This fixes content hidden in collapsed accordion panels
  body = body.replace(/<div[^>]*class="[^"]*panel-body[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, (match, content) => {
    return content;
  });

  body = body
    .replace(/<h([1-6])[^>]*>/gi, (_, level) => `\n\n##H${level}## `)
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<br\s*\/?>(?=.)/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<tr[^>]*>/gi, '\n##TR## ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<t[dh][^>]*>/gi, ' | ')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  body = decodeHtml(body);
  return finalizeWhitespace(body, opts);
}

function finalizeWhitespace(body: string, opts: CleanPageOptions): string {
  return body
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

// ---------- plaintext cleaning (for the rebuild) ----------
function cleanPlaintext(text: string, opts: CleanPageOptions = {}): string {
  let body = text;

  // (a) drop the literal chrome header (best-effort) when present
  const chromePrefixRegex = /^\s*NEC[N]?\s*Nellore\s*\|?\s*Narayana Engineering College[\s\S]*?(?=##H1##|^[A-Z][A-Za-z0-9 \-]{4,80}$|\n[A-Z][a-z])/m;
  if (chromePrefixRegex.test(body)) body = body.replace(chromePrefixRegex, '');

  // (b) drop literal fingerprint lines
  body = body
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      return !KNOWN_CHROME_FINGERPRINTS.some(fp => trimmed === fp.trim());
    })
    .join('\n');

  // (c) frequency pass against precomputed chrome map
  if (opts.chromeMap && opts.chromeMap.size) {
    body = stripChromeByMap(body, opts.chromeMap);
  }

  // (d) tag known strong headings
  body = body.split('\n').map(line => {
    const t = line.trim();
    if (HEADING_HINTS.some(re => re.test(t))) return `##H1## ${t}`;
    return line;
  }).join('\n');

  return finalizeWhitespace(body, opts);
}

function stripChromeByMap(body: string, chromeMap: Map<string, ChromeBlock>): string {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length) {
    let dropped = false;
    for (const windowSize of [5, 3, 1]) {
      if (i + windowSize > lines.length) continue;
      // Don't drop blocks where every line is very long — those are real prose.
      if (windowSize !== 3 && lines.slice(i, i + windowSize).every(l => l.trim().length > 80)) continue;
      const block = lines.slice(i, i + windowSize).join('\n').trim().toLowerCase().replace(/\s+/g, ' ');
      const hash = crypto.createHash('sha256').update(block).digest('hex');
      if (chromeMap.has(hash)) { i += windowSize; dropped = true; break; }
    }
    if (!dropped) i++;
  }
  return lines.join('\n');
}

// ---------- chrome block detection ----------
export function detectChromeBlocks(
  pages: Array<{ url: string; content: string }>,
  opts: { minOccurrences?: number } = {}
): Map<string, ChromeBlock> {
  const minOcc = opts.minOccurrences ?? 3;
  const counts = new Map<string, { hash: string; text: string; pageCount: number }>();

  for (const page of pages) {
    const lines = page.content.split('\n').map(l => l.trim()).filter(Boolean);
    const seen = new Set<string>();
    for (const windowSize of [3, 1, 5]) {
      for (let i = 0; i + windowSize <= lines.length; i++) {
        if (windowSize !== 3 && lines.slice(i, i + windowSize).every(l => l.length > 80)) continue;
        const block = lines.slice(i, i + windowSize).join('\n');
        const norm = block.toLowerCase().replace(/\s+/g, ' ').trim();
        const hash = crypto.createHash('sha256').update(norm).digest('hex');
        if (seen.has(hash)) continue;
        seen.add(hash);
        const entry = counts.get(hash) || { hash, text: block, pageCount: 0 };
        entry.pageCount++;
        counts.set(hash, entry);
      }
    }
  }

  const result = new Map<string, ChromeBlock>();
  for (const [hash, entry] of counts) {
    if (entry.pageCount >= minOcc) result.set(hash, entry);
  }
  return result;
}

// ---------- public dispatch ----------
export function cleanPageContent(input: string, opts: CleanPageOptions = {}): string {
  if (!input) return '';
  const looksLikeHtml = /<\s*(html|body|div|p|h[1-6]|li|tr|td|nav|header|footer|aside|main|article|section)\b/i.test(input);
  return looksLikeHtml ? cleanHtml(input, opts) : cleanPlaintext(input, opts);
}

// ---------- title extraction ----------
function titleFromUrl(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'NECN Document');
    return name.replace(/\.(?:pdf|php|html?|aspx?)$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'NECN Official Document';
  } catch {
    return 'NECN Official Document';
  }
}

export function extractMeaningfulTitle(input: string, url: string, opts: CleanPageOptions = {}): string {
  if (input) {
    // h1 is the most reliable signal on NECN pages.
    const h1 = input.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) {
      const cleaned = decodeHtml(stripTags(h1[1])).replace(/\s+/g, ' ').trim();
      if (cleaned) return cleaned;
    }
    // <title> may be the chrome default; strip the chrome suffix.
    const t = input.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) {
      const cleaned = decodeHtml(stripTags(t[1])).replace(/\s+/g, ' ').trim();
      const stripped = cleaned
        .replace(/\s*[\-|–|—]\s*(NECN|Narayana.*|.*Engineering.*|.*Nellore.*)$/i, '')
        .replace(/^NEC Nellore\s*\|\s*Narayana Engineering College\s*$/i, '')
        .trim();
      if (stripped) return stripped;
    }
  }
  return titleFromUrl(url);
}

// ---------- section/department detection ----------
const DEPARTMENT_KEYS: Record<string, string> = {
  CSE: 'Computer Science Engineering',
  ECE: 'Electronics Communication Engineering',
  EEE: 'Electrical Electronics Engineering',
  MECH: 'Mechanical Engineering',
  CIVIL: 'Civil Engineering',
  MBA: 'Master of Business Administration',
  MCA: 'Master of Computer Applications',
  FED: 'Freshman Engineering Department',
  HS: 'Humanities & Sciences'
};

const SECTION_KEYS: Array<{ regex: RegExp; section: string }> = [
  { regex: /\/admission[s]?\b/i, section: 'Admissions' },
  { regex: /\/placement|\/training/i, section: 'Placements' },
  { regex: /\/research|\/publication|\/patent/i, section: 'Research' },
  { regex: /\/academic|\/syllabus|\/regulation|\/calendar|\/examination/i, section: 'Academics' },
  { regex: /\/campus|\/hostel|\/library|\/club|\/facilit/i, section: 'Campus Life' },
  { regex: /\/iqac|\/naac|\/nba|\/accredit/i, section: 'Accreditation & IQAC' },
  { regex: /\/(pdf|notice|policy|report|committee)/i, section: 'Official Documents' },
  { regex: /\/(gallery|alumni|event)/i, section: 'Events & Media' },
  { regex: /\/faculty/i, section: 'Faculty' },
  { regex: /\/(index|home)/i, section: 'Home' }
];

export function detectSectionMetadata(url: string, _input?: string, _opts?: CleanPageOptions): SectionMetadata {
  let urlSlug = '';
  let department: string | null = null;
  let section: string | null = null;

  try {
    const u = new URL(url);
    urlSlug = u.pathname;
    const segments = urlSlug.split('/').filter(Boolean);

    // Department inference from URL path segment, e.g. /MECH/faculty.php
    for (const seg of segments) {
      const upper = seg.toUpperCase().replace(/\..*$/, '');
      if (DEPARTMENT_KEYS[upper]) { department = DEPARTMENT_KEYS[upper]; break; }
    }

    // Section inference
    for (const key of SECTION_KEYS) {
      if (key.regex.test(urlSlug) || key.regex.test(u.hostname + urlSlug)) {
        section = key.section;
        break;
      }
    }
  } catch {
    urlSlug = url;
  }

  return { section, department, urlSlug };
}
