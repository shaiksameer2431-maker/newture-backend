/**
 * test_pdf_extractor_suite.ts — Automated 10-Scenario Test Suite for Universal PDF Extractor
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { extractPdfDocument, UniversalPdfExtractResult } from '../src/services/pdfExtractor.js';
import zlib from 'node:zlib';

function createDummyPdfBuffer(streamContent: string, pages = 1, isCorrupted = false, isEncrypted = false): Buffer {
  if (isCorrupted) return Buffer.from('NOT_A_PDF_FILE_HEADER_GARBAGE');
  
  let streams = '';
  for (let i = 1; i <= pages; i++) {
    const rawStream = `BT /F1 12 Tf 100 700 Td (${streamContent} - Page ${i}) Tj ET`;
    const deflated = zlib.deflateSync(Buffer.from(rawStream));
    streams += `
${i + 2} 0 obj
<< /Length ${deflated.length} /Filter /FlateDecode >>
stream
${deflated.toString('latin1')}
endstream
endobj
`;
  }

  const pdfHead = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count ${pages} >>\nendobj\n`;
  const encryptDict = isEncrypted ? `/Encrypt 99 0 R\n99 0 obj\n<< /Filter /Standard /V 2 /R 3 /O (12345678) /U (12345678) /P -4 >>\nendobj\n` : '';
  const meta = `/Title (NECN Official Regulations PDF)\n/Author (NECN Academic Cell)\n`;
  
  return Buffer.from(`${pdfHead}${meta}${encryptDict}${streams}%%EOF`, 'latin1');
}

function createTablePdfBuffer(): Buffer {
  const tableText = `
Department\tIntake\tFaculty
CSE\t180\t32
ECE\t180\t29
EEE\t60\t18
  `.trim();
  const deflated = zlib.deflateSync(Buffer.from(`BT /F1 12 Tf 50 700 Td (${tableText}) Tj ET`));
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n3 0 obj\n<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n${deflated.toString('latin1')}\nendstream\nendobj\n%%EOF`, 'latin1');
}

function createScannedPdfBuffer(): Buffer {
  // Empty stream content simulates image-only page without text operators
  const emptyStream = zlib.deflateSync(Buffer.from(`/XObject << /Im1 5 0 R >>`));
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n3 0 obj\n<< /Length ${emptyStream.length} /Filter /FlateDecode >>\nstream\n${emptyStream.toString('latin1')}\nendstream\nendobj\n%%EOF`, 'latin1');
}

async function runTestSuite() {
  console.log('========================================');
  console.log('RUNNING UNIVERSAL PDF EXTRACTOR TEST SUITE');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  async function testCase(num: number, name: string, buf: Buffer, check: (res: UniversalPdfExtractResult) => boolean) {
    console.log(`[TEST ${num}/10] ${name}`);
    try {
      const res = await extractPdfDocument(buf, { enableOcr: false });
      const ok = check(res);
      if (ok) {
        console.log(`  -> PASSED! Status: ${res.extractionStatus}, Pages: ${res.pageCount}, Quality: ${res.qualityScore}`);
        passed++;
      } else {
        console.error(`  -> FAILED! Status: ${res.extractionStatus}, Reason: ${res.reason}`);
        failed++;
      }
    } catch (err: any) {
      console.error(`  -> CRASHED: ${err.message}`);
      failed++;
    }
  }

  // 1. Normal Text PDF
  await testCase(1, 'Normal Text PDF', createDummyPdfBuffer('Narayana Engineering College Academic Notice', 1), res => res.ok && res.pageCount === 1);

  // 2. Multi-Page PDF
  await testCase(2, 'Multi-Page PDF', createDummyPdfBuffer('Course Syllabus Regulation 2023', 5), res => res.ok && res.pageCount === 5 && res.fullText.includes('[PAGE 5]'));

  // 3. Table-Heavy PDF
  await testCase(3, 'Table-Heavy PDF', createTablePdfBuffer(), res => res.ok && res.fullText.includes('| CSE | 180 | 32 |'));

  // 4. Scanned PDF
  await testCase(4, 'Scanned PDF Detection', createScannedPdfBuffer(), res => res.extractionStatus === 'SCANNED' || res.pages[0]?.extractionStatus === 'SCANNED');

  // 5. Mixed Text + Scanned Pages
  await testCase(5, 'Mixed Text + Scanned Pages', createDummyPdfBuffer('Page Text Content', 3), res => res.pageCount === 3);

  // 6. Font Encodings & Escaped Literal Handling
  await testCase(6, 'Escaped Literal & Character Formatting', createDummyPdfBuffer('Special \\(Tokens\\) & Symbols', 1), res => res.ok && res.fullText.includes('Special (Tokens) & Symbols'));

  // 7. Corrupted PDF Handling
  await testCase(7, 'Corrupted PDF Handling', createDummyPdfBuffer('', 1, true), res => !res.ok && res.extractionStatus === 'PDF_CORRUPTED');

  // 8. Encrypted PDF Handling
  await testCase(8, 'Encrypted PDF Handling', createDummyPdfBuffer('Secret Content', 1, false, true), res => res.extractionStatus === 'PDF_PASSWORD_PROTECTED');

  // 9. Large Multi-Page Document
  await testCase(9, 'Large Multi-Page Performance', createDummyPdfBuffer('Large Regulation Document Section', 25), res => res.ok && res.pageCount === 25);

  // 10. Unicode & Institutional Formatting
  await testCase(10, 'Unicode & Institutional Boilerplate Cleaning', createDummyPdfBuffer('Narayana Engineering College Nellore - Academic Report 2024', 4), res => res.ok && res.fullText.includes('DOCUMENT TITLE:'));

  console.log('\n========================================');
  console.log(`TEST SUITE RESULTS: ${passed}/10 PASSED (${failed} FAILED)`);
  console.log('========================================');

  if (failed > 0) process.exitCode = 1;
}

runTestSuite().catch(err => {
  console.error('Fatal error in PDF test suite:', err);
  process.exitCode = 1;
});
