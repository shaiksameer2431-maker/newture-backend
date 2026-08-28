import fs from 'fs';
import path from 'path';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

export function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  return UPLOADS_DIR;
}

export function saveUploadedFile(buffer, originalName) {
  ensureUploadsDir();
  const ext = path.extname(originalName) || '.bin';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const relativePath = path.join('uploads', filename).replace(/\\/g, '/');
  const fullPath = path.join(process.cwd(), relativePath);
  fs.writeFileSync(fullPath, buffer);
  return relativePath;
}

export function saveBase64Image(dataUrl, prefix = 'notice') {
  const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches) throw new Error('Invalid base64 image data');
  const ext = matches[1].includes('png') ? '.png' : matches[1].includes('webp') ? '.webp' : '.jpg';
  const buffer = Buffer.from(matches[2], 'base64');
  ensureUploadsDir();
  const filename = `${prefix}-${Date.now()}${ext}`;
  const relativePath = path.join('uploads', filename).replace(/\\/g, '/');
  fs.writeFileSync(path.join(process.cwd(), relativePath), buffer);
  return relativePath;
}
