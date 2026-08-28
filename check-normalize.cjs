const SKIP_EXTENSIONS = /\.(?:jpg|jpeg|png|gif|webp|svg|ico|mp4|mp3|wav|zip|rar|7z|doc|docx|xls|xlsx|ppt|pptx|css|js|mjs|map|woff|woff2|ttf|eot)$/i;
function normalizeUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    url.hash = '';
    url.search = '';
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (SKIP_EXTENSIONS.test(url.pathname)) return null;
    return url.toString().replace(/\/$/, '') || url.protocol + '//' + url.host;
  } catch {
    return null;
  }
}
console.log(normalizeUrl('pdf/Policy Research.pdf#toolbar=0', 'https://necn.ac.in/Research-Policy.php'));
