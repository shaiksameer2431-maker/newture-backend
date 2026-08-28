const html = `<iframe src="pdf/Policy Research.pdf#toolbar=0" width="1200px" height="550px"></iframe>`;
const attributeRegex = /<(?:a|area|iframe|object|embed|source|link)\b[^>]*?(?:href|src|data)\s*=\s*["']([^"']+)["'][^>]*>/gi;
let match;
while ((match = attributeRegex.exec(html))) console.log(match[1]);
