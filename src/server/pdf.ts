/**
 * PDF page count via unpdf (serverless pdf.js) — runs inside the Worker.
 * We only need the page count for completion math and the analytics chart;
 * the viewer renders pages client-side from the original bytes.
 */
export async function pdfPageCount(bytes: ArrayBuffer): Promise<number> {
  const { getDocumentProxy } = await import("unpdf");
  // pdf.js TRANSFERS the buffer it is given (detaching it — byteLength becomes
  // 0 for the caller), so it must get a copy: the caller still needs the real
  // bytes to store. Found by a real upload landing 0 bytes in storage.
  const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
  return pdf.numPages;
}

export function isPdf(filename: string, mime: string): boolean {
  return mime === "application/pdf" || /\.pdf$/i.test(filename);
}
