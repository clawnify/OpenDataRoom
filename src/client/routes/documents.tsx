import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload } from "lucide-react";
import { api, fmtBytes, fmtDate, timeAgo, type Doc } from "../api";
import { Button, Empty, Eyebrow, Input, Toolbar } from "../components/ui";

export default function Documents() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (p: number, s: string) => {
    const res = await api.documents({ page: p, search: s || undefined });
    setDocs(res.documents);
    setTotal(res.total);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(page, search).catch(() => setError("Unable to load documents. Reload to try again.")), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [page, search, load]);

  const upload = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const doc = await api.uploadDocument(file);
      navigate(`/documents/${doc.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <>
      <Toolbar title="Documents" subtitle={total ? `${total} in the library` : undefined}>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        {docs.length > 0 || search ? (
          <Button variant="primary" disabled={uploading} onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" />
            {uploading ? "Uploading…" : "Upload document"}
          </Button>
        ) : null}
      </Toolbar>

      <div className="p-6">
        {error ? <p className="mb-4 rounded-sm bg-danger-tint px-3 py-2 text-[0.8125rem] text-danger">{error}</p> : null}
        <div className="mb-4 flex items-center justify-between gap-4">
          <Eyebrow>Library</Eyebrow>
          <div className="w-64">
            <Input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by name"
              aria-label="Search documents"
            />
          </div>
        </div>

        {docs.length === 0 ? (
          search ? (
            <Empty title={`No documents match “${search}”`} action={<Button variant="ghost" onClick={() => setSearch("")}>Clear search</Button>} />
          ) : (
            <Empty
              title="No documents yet"
              hint="Upload a PDF, then create a share link to start tracking who reads it."
              action={
                <Button variant="primary" disabled={uploading} onClick={() => fileInput.current?.click()}>
                  <Upload className="size-4" />
                  {uploading ? "Uploading…" : "Upload document"}
                </Button>
              }
            />
          )
        ) : (
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="border-y border-border bg-sunken text-left text-[0.8125rem] font-medium text-muted">
                  <th className="px-3 py-2.5 first:pl-6">Name</th>
                  <th className="data px-3 py-2.5 text-right">Pages</th>
                  <th className="data px-3 py-2.5 text-right">Size</th>
                  <th className="data px-3 py-2.5 text-right">Links</th>
                  <th className="data px-3 py-2.5 text-right">Visits</th>
                  <th className="px-3 py-2.5">Last viewed</th>
                  <th className="px-3 py-2.5 last:pr-6">Added</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr
                    key={d.id}
                    className="cursor-pointer border-b border-border transition-colors hover:bg-sunken"
                    onClick={() => navigate(`/documents/${d.id}`)}
                  >
                    <td className="px-3 py-2.5 first:pl-6">
                      <button
                        type="button"
                        className="link max-w-md truncate text-left font-medium"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/documents/${d.id}`);
                        }}
                      >
                        {d.name}
                      </button>
                    </td>
                    <td className="data px-3 py-2.5 text-right">{d.page_count}</td>
                    <td className="data px-3 py-2.5 text-right">{fmtBytes(d.size_bytes)}</td>
                    <td className="data px-3 py-2.5 text-right">{d.link_count ?? 0}</td>
                    <td className="data px-3 py-2.5 text-right">{d.visit_count ?? 0}</td>
                    <td className="px-3 py-2.5 text-muted">{timeAgo(d.last_viewed_at)}</td>
                    <td className="px-3 py-2.5 text-muted last:pr-6">{fmtDate(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 ? (
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span className="data text-xs text-muted">
              {page} / {pages}
            </span>
            <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
