/**
 * chunker.ts — heading-aware, structure-preserving chunker.
 *
 * Inputs are plaintext (cleaned by contentCleaner.ts). The chunker splits
 * on \n\n boundaries, classifies segments as heading/table/list/paragraph,
 * and emits chunks bounded by 800-1200 chars with a 150-char overlap on
 * size-driven flushes. Tables and lists are never split mid-segment.
 */

export interface ChunkOptions {
  targetMinChars?: number;
  targetMaxChars?: number;
  overlapChars?: number;
  preserve?: Array<'table' | 'list'>;
}

export interface StructuredChunk {
  heading: string;
  content: string;
  index: number;
  startOffset: number;
  endOffset: number;
  sectionHint: string | null;
}

type SegmentType = 'heading' | 'table' | 'list' | 'paragraph';
interface Segment {
  type: SegmentType;
  heading: string | null;
  text: string;
}

function classifyBlock(block: string): Segment {
  const lines = block.split('\n').filter(Boolean);
  if (!lines.length) return { type: 'paragraph', heading: null, text: block };
  const first = lines[0].trim();

  const headingMatch = first.match(/^##H([1-6])##\s*(.+?)\s*$/);
  if (headingMatch) {
    return {
      type: 'heading',
      heading: headingMatch[2],
      text: lines.join('\n')
    };
  }

  if (lines.some(l => /##TR##/.test(l))) {
    return { type: 'table', heading: null, text: lines.join('\n') };
  }
  if (lines.every(l => /^\s*•/.test(l))) {
    return { type: 'list', heading: null, text: lines.join('\n') };
  }
  return { type: 'paragraph', heading: null, text: lines.join('\n') };
}

export function chunkStructuredText(content: string, opts: ChunkOptions = {}): StructuredChunk[] {
  const min = opts.targetMinChars ?? 800;
  const max = opts.targetMaxChars ?? 1200;
  const overlap = opts.overlapChars ?? 150;
  const preserve = new Set(opts.preserve ?? ['table', 'list']);

  if (!content?.trim()) return [];

  const segments: Segment[] = content
    .split(/\n\n+/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(classifyBlock);

  const chunks: StructuredChunk[] = [];
  let buffer = '';
  let bufferStart = 0;
  let currentHeading = '';
  let cursor = 0;

  const flush = (reason: 'size' | 'boundary'): void => {
    if (!buffer.trim()) {
      buffer = '';
      bufferStart = chunks.length ? chunks[chunks.length - 1].endOffset : 0;
      return;
    }
    chunks.push({
      heading: currentHeading,
      content: buffer.trim(),
      index: chunks.length,
      startOffset: bufferStart,
      endOffset: bufferStart + buffer.length,
      sectionHint: currentHeading || null
    });
    if (reason === 'size' && buffer.length > overlap) {
      const tail = buffer.slice(buffer.length - overlap);
      const cut = tail.indexOf('\n');
      if (cut > 0) {
        const keep = tail.slice(cut + 1);
        buffer = keep;
        bufferStart = chunks[chunks.length - 1].endOffset - keep.length;
      } else {
        buffer = '';
        bufferStart = chunks[chunks.length - 1].endOffset;
      }
    } else {
      buffer = '';
      bufferStart = chunks.length ? chunks[chunks.length - 1].endOffset : 0;
    }
  };

  for (const seg of segments) {
    if (seg.type === 'heading') {
      if (buffer.length >= min) flush('boundary');
      currentHeading = seg.heading || currentHeading;
      if (seg.text.length > max) {
        const segLines = seg.text.split('\n');
        buffer = segLines[0] + '\n';
        for (let k = 1; k < segLines.length; k++) {
          if (buffer.length + segLines[k].length + 1 > max && buffer.length >= min) {
            flush('size');
          }
          buffer = (buffer ? buffer + '\n' : '') + segLines[k];
        }
      } else {
        buffer = seg.text + '\n';
      }
      bufferStart = cursor;
      cursor += seg.text.length + 1;
      continue;
    }

    const candidateText = (buffer ? buffer + '\n' : '') + seg.text;
    if (preserve.has(seg.type) && (seg.type === 'table' || seg.type === 'list')) {
      if (seg.text.length > max) {
        if (buffer.length >= min) flush('boundary');
        const lines = seg.text.split('\n').filter(Boolean);
        let headerLine = '';
        let rowLines = lines;
        if (seg.type === 'table' && lines.length > 1) {
          headerLine = lines[0];
          rowLines = lines.slice(1);
        }
        for (const line of rowLines) {
          if (buffer.length + line.length + 1 > max && buffer.length >= min) {
            flush('size');
            buffer = headerLine ? headerLine + '\n' + line : line;
          } else {
            buffer = (buffer ? buffer + '\n' : '') + line;
          }
        }
        cursor += seg.text.length + 1;
      } else {
        if (buffer.length + seg.text.length + 1 > max && buffer.length >= min) flush('size');
        buffer = (buffer ? buffer + '\n' : '') + seg.text;
        cursor += seg.text.length + 1;
      }
    } else {
      if (candidateText.length > max && buffer.length >= min) flush('size');
      buffer = candidateText;
      cursor += seg.text.length + 1;
    }
  }

  if (buffer.trim()) flush('boundary');
  return chunks;
}
