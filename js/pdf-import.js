// PDF import: renders every page to an image (one slide per page) with pdf.js (vendored, loaded on demand).
// Exporting slides to PDF from PowerPoint, Keynote or Google Slides gives a pixel-exact copy.

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdfjs/pdf.min.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * readPdf(file, { onProgress, width }) → [{ index, blob, w, h, label }]
 * width: rendered width in pixels (default 2000, enough for a full-screen iPad mini at 2×).
 */
export async function readPdf(file, { onProgress, width = 2000 } = {}) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    if (onProgress) onProgress(`Rendering page ${i} of ${doc.numPages}…`, (i - 1) / doc.numPages);
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(width / vp1.width, 4);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    let label = '';
    try {
      const tc = await page.getTextContent();
      label = tc.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    } catch (_) {}
    out.push({ index: i, blob, w: canvas.width, h: canvas.height, label });
    page.cleanup();
    canvas.width = canvas.height = 0;
  }
  await doc.destroy();
  return out;
}
