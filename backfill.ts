import { backfillWebsiteEmbeddings } from './src/services/websiteSearch.js';

async function main() {
  console.log("Starting embedding backfill...");
  const res = await backfillWebsiteEmbeddings(200);
  console.log("Backfill result:", res);
}

main().catch(console.error);
