import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'https://necn.ac.in';

const PAGES_TO_INSPECT = [
  { name: 'admission', url: `${BASE_URL}/admission.php` },
  { name: 'college-fees', url: `${BASE_URL}/college-fees.php` },
  { name: 'facilities', url: `${BASE_URL}/facilites.php` },
  { name: 'research-activities', url: `${BASE_URL}/research-activites.php` },
  { name: 'research-policy', url: `${BASE_URL}/Research-Policy.php` },
  { name: 'placement-stats', url: `${BASE_URL}/2023-24-placements.php` }
];

async function inspectPage(page) {
  console.log(`\n=== INSPECTING: ${page.name} ===`);
  console.log(`URL: ${page.url}`);

  try {
    const response = await fetch(page.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    console.log(`HTTP Status: ${response.status} ${response.statusText}`);
    console.log(`Final URL: ${response.url}`);
    console.log(`Content-Type: ${response.headers.get('content-type')}`);

    const finalUrl = response.url;
    const contentType = response.headers.get('content-type');
    const html = await response.text();

    console.log(`Raw HTML size: ${html.length} bytes`);
    console.log(`Number of HTML elements: ${(html.match(/<[^>]+>/g) || []).length}`);

    // Count navigation elements
    const navMatches = html.match(/<nav[^>]*>.*?<\/nav>/gis) || [];
    console.log(`Number of <nav> elements: ${navMatches.length}`);

    // Count script tags
    const scriptMatches = html.match(/<script[^>]*>.*?<\/script>/gis) || [];
    console.log(`Number of <script> tags: ${scriptMatches.length}`);

    // Check for iframe
    const hasIframe = html.includes('<iframe');
    console.log(`Contains iframe: ${hasIframe}`);

    // Check for template
    const hasTemplate = html.includes('<template');
    console.log(`Contains template: ${hasTemplate}`);

    // Check for hidden elements
    const hiddenMatches = html.match(/hidden/gi) || [];
    console.log(`"hidden" attribute count: ${hiddenMatches.length}`);

    // Extract visible body text (naive)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;
    const visibleText = bodyContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`Visible body text size: ${visibleText.length} chars`);

    // Check for dynamic content indicators
    const hasReact = html.includes('react') || html.includes('React');
    const hasVue = html.includes('vue') || html.includes('Vue');
    const hasAngular = html.includes('angular') || html.includes('Angular');
    const hasFetch = html.includes('fetch(') || html.includes('axios');
    const hasXhr = html.includes('XMLHttpRequest');

    console.log(`React detected: ${hasReact}`);
    console.log(`Vue detected: ${hasVue}`);
    console.log(`Angular detected: ${hasAngular}`);
    console.log(`Fetch/AJAX detected: ${hasFetch}`);
    console.log(`XHR detected: ${hasXhr}`);

    // Save raw HTML for forensic comparison
    const outputDir = join(__dirname, 'forensic-html');
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${page.name}.html`);
    writeFileSync(outputPath, html);
    console.log(`Raw HTML saved to: ${outputPath}`);

    return {
      name: page.name,
      url: page.url,
      finalUrl,
      status: response.status,
      contentType,
      htmlSize: html.length,
      elementCount: (html.match(/<[^>]+>/g) || []).length,
      navCount: navMatches.length,
      scriptCount: scriptMatches.length,
      hasIframe,
      hasTemplate,
      hiddenCount: hiddenMatches.length,
      visibleTextSize: visibleText.length,
      hasReact,
      hasVue,
      hasAngular,
      hasFetch,
      hasXhr
    };

  } catch (error) {
    console.error(`ERROR fetching ${page.url}:`, error.message);
    return {
      name: page.name,
      url: page.url,
      error: error.message
    };
  }
}

async function main() {
  console.log('============================================================');
  console.log('PHASE 1: INSPECT MISSING-CONTENT PAGES');
  console.log('============================================================');

  const results = [];
  for (const page of PAGES_TO_INSPECT) {
    const result = await inspectPage(page);
    results.push(result);
  }

  console.log('\n============================================================');
  console.log('SUMMARY');
  console.log('============================================================');

  for (const result of results) {
    if (result.error) {
      console.log(`${result.name}: ERROR - ${result.error}`);
    } else {
      console.log(`${result.name}:`);
      console.log(`  Status: ${result.status}`);
      console.log(`  HTML size: ${result.htmlSize} bytes`);
      console.log(`  Visible text: ${result.visibleTextSize} chars`);
      console.log(`  Scripts: ${result.scriptCount}`);
      console.log(`  Dynamic indicators: React=${result.hasReact} Fetch=${result.hasFetch}`);
    }
  }
}

main().catch(console.error);
