import { crawlWebsite } from './src/services/websiteCrawler.js';

const PAGES_TO_RECRAWL = [
  'https://necn.ac.in/admission.php',
  'https://necn.ac.in/college-fees.php',
  'https://necn.ac.in/facilites.php',
  'https://necn.ac.in/research-activites.php',
  'https://necn.ac.in/Research-Policy.php',
  'https://necn.ac.in/2023-24-placements.php'
];

console.log('============================================================');
console.log('PHASE 8: REBUILD AFFECTED KNOWLEDGE');
console.log('============================================================\n');

console.log('Recrawling affected pages with improved content extraction...');
console.log('Pages to recrawl:', PAGES_TO_RECRAWL.length);
console.log();

try {
  const result = await crawlWebsite({
    startUrl: 'https://necn.ac.in',
    maxPages: 0, // Unlimited, but we'll only recrawl the specified URLs
    type: 'RETRY_FAILED',
    retryOnlyUrls: PAGES_TO_RECRAWL,
    timeoutMs: 30000
  });

  console.log('\n============================================================');
  console.log('REBUILD COMPLETE');
  console.log('============================================================');
  console.log(`Discovered: ${result.discovered}`);
  console.log(`Crawled: ${result.crawled}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`New: ${result.new}`);
  console.log(`Unchanged: ${result.unchanged}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`Chunks created: ${result.chunks}`);
  console.log(`PDF documents: ${result.pdfDocuments}`);
  console.log();

} catch (error) {
  console.error('Error during rebuild:', error);
  process.exit(1);
}
