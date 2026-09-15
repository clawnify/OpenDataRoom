import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "./ui";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    dialog.current?.showModal();
    return () => { dialog.current?.close(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loading = getDocument({ url, isEvalSupported: false });
    loading.promise.then(document => {
      if (!cancelled) setPdf(document);
    }).catch(() => { if (!cancelled) { setError("Unable to preview this PDF. You can still download it."); setRendering(false); } });
    return () => { cancelled = true; void loading.destroy(); };
  }, [url]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    setRendering(true);
    setError("");
    setText("");
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !canvas.current) return;
        const viewport = page.getViewport({ scale: 1 });
        // Bound canvas memory even when a PDF declares an unusually large page.
        const scale = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
        const element = canvas.current;
        element.width = Math.ceil(viewport.width * scale);
        element.height = Math.ceil(viewport.height * scale);
        const context = element.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable");
        task = page.render({ canvasContext: context, viewport, transform: [scale, 0, 0, scale, 0, 0] });
        await task.promise;
        const content = await page.getTextContent();
        if (!cancelled) setText(content.items.map(item => "str" in item ? item.str : "").join(" "));
      } catch {
        if (!cancelled) setError("Unable to render this page. You can still download the PDF.");
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber]);

  return <dialog ref={dialog} aria-label={`Preview ${name}`} onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-2xl rounded-lg border border-border bg-surface p-0 text-foreground shadow-float backdrop:bg-foreground/25">
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h2>
      <a href={url} download={name} className="text-sm underline">Download PDF</a>
      <Button onClick={onClose}>Close preview</Button>
    </div>
    <div className="bg-sunken p-4" aria-busy={rendering}>
      {rendering && <p role="status" className="mb-3 text-sm text-muted">Loading preview…</p>}
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      <canvas ref={canvas} aria-hidden="true" className="h-auto w-full bg-white" />
      <p className="sr-only">{text}</p>
    </div>
    <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3">
      <Button disabled={!pdf || pageNumber <= 1 || rendering} onClick={() => setPageNumber(pageNumber - 1)}>Previous page</Button>
      <span className="text-sm" aria-live="polite">Page {pageNumber} of {pdf?.numPages ?? "…"}</span>
      <Button disabled={!pdf || pageNumber >= pdf.numPages || rendering} onClick={() => setPageNumber(pageNumber + 1)}>Next page</Button>
    </div>
  </dialog>;
}
