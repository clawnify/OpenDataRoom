import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, Plus } from "lucide-react";
import {
  api,
  fmtBytes,
  fmtDate,
  fmtDuration,
  timeAgo,
  type Doc,
  type DocAnalytics,
  type Link,
  type Visit,
} from "../api";
import { PageBarChart } from "../components/chart";
import { LinkDialog, LinksTable } from "../components/links";
import { Button, Card, CompletionRing, ConfirmDialog, Empty, Eyebrow, Stat, Toolbar, Zone } from "../components/ui";

export default function DocumentDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [analytics, setAnalytics] = useState<DocAnalytics | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitTotal, setVisitTotal] = useState(0);
  const [visitPage, setVisitPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, a, l] = await Promise.all([api.document(id), api.documentAnalytics(id), api.documentLinks(id)]);
      setDoc(d);
      setAnalytics(a);
      setLinks(l.links);
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .documentVisits(id, visitPage)
      .then((r) => {
        setVisits(r.visits);
        setVisitTotal(r.total);
      })
      .catch(() => {});
  }, [id, visitPage]);

  if (missing) {
    return (
      <>
        <Toolbar title="Document not found" />
        <Empty title="This document no longer exists." action={<Button onClick={() => navigate("/documents")}>Back to documents</Button>} />
      </>
    );
  }
  if (!doc || !analytics) return <Toolbar title="…" />;

  const t = analytics.totals;
  const visitPages = Math.max(1, Math.ceil(visitTotal / 25));

  return (
    <>
      <Toolbar
        title={
          <span className="inline-flex items-center gap-2">
            <RouterLink to="/documents" aria-label="Back to documents" className="rounded-sm p-1 text-muted transition-colors hover:bg-sunken hover:text-foreground">
              <ArrowLeft className="size-4" />
            </RouterLink>
            {doc.name}
          </span>
        }
        subtitle={`${doc.page_count} pages · ${fmtBytes(doc.size_bytes)} · added ${fmtDate(doc.created_at)}`}
      >
        <Button onClick={() => window.open(`/api/documents/${doc.id}/file`, "_blank")}>
          <Download className="size-4" />
          Preview
        </Button>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Create link
        </Button>
      </Toolbar>

      <div className="space-y-6 p-6">
        <Card>
          <Zone>
            <Eyebrow right={`${t.visits} ${t.visits === 1 ? "visit" : "visits"}`}>Engagement</Eyebrow>
            <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat label="Visits" value={t.visits} meta={`${t.unique_viewers} unique ${t.unique_viewers === 1 ? "viewer" : "viewers"}`} />
              <Stat label="Avg. time" value={fmtDuration(t.avg_seconds)} meta={`${fmtDuration(t.total_seconds)} total`} />
              <Stat label="Completion" value={`${Math.round(t.avg_completion * 100)}%`} meta="average share of pages read" />
              <Stat label="Downloads" value={t.downloads} meta={links.some((l) => l.allow_download === 1) ? "downloads allowed" : "downloads off"} />
            </div>
          </Zone>
          <Zone>
            <Eyebrow right={`avg seconds per page · ${doc.page_count} pages`}>Time per page</Eyebrow>
            <div className="mt-4">
              {analytics.per_page.length ? (
                <PageBarChart perPage={analytics.per_page} pageCount={analytics.page_count} />
              ) : (
                <p className="py-8 text-center text-sm text-muted">No reading data yet — it appears as soon as someone opens a link.</p>
              )}
            </div>
          </Zone>
        </Card>

        <section>
          <div className="mb-3">
            <Eyebrow right={`${links.length}`}>Links</Eyebrow>
          </div>
          <LinksTable
            links={links}
            onCreateClick={() => setCreating(true)}
            onUpdate={async (linkId, input) => {
              await api.updateLink(linkId, input);
              await load();
            }}
            onDelete={async (linkId) => {
              await api.deleteLink(linkId);
              await load();
            }}
          />
        </section>

        <section>
          <div className="mb-3">
            <Eyebrow right={`${visitTotal}`}>Visits</Eyebrow>
          </div>
          {visits.length === 0 ? (
            <Empty title="No visits yet" hint="Send a link — every open lands here with reading time and completion." />
          ) : (
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="border-y border-border bg-sunken text-left text-xs font-semibold tracking-[0.04em] text-muted">
                    <th className="px-3 py-2.5 first:pl-6">Visitor</th>
                    <th className="px-3 py-2.5">Link</th>
                    <th className="data px-3 py-2.5 text-right">Duration</th>
                    <th className="px-3 py-2.5">Completion</th>
                    <th className="data px-3 py-2.5 text-right">Downloads</th>
                    <th className="px-3 py-2.5 last:pr-6">When</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => (
                    <tr key={v.id} className="border-b border-border transition-colors hover:bg-sunken">
                      <td className="px-3 py-2.5 font-medium first:pl-6">{v.email || "Anonymous"}</td>
                      <td className="max-w-40 truncate px-3 py-2.5 text-muted">{v.link_name || "Untitled link"}</td>
                      <td className="data px-3 py-2.5 text-right">{fmtDuration(v.total_seconds)}</td>
                      <td className="px-3 py-2.5">
                        <CompletionRing fraction={v.completion} />
                      </td>
                      <td className="data px-3 py-2.5 text-right">{v.downloaded}</td>
                      <td className="px-3 py-2.5 text-muted last:pr-6">{timeAgo(v.last_seen_at || v.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {visitPages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button disabled={visitPage <= 1} onClick={() => setVisitPage(visitPage - 1)}>
                Previous
              </Button>
              <span className="data text-xs text-muted">
                {visitPage} / {visitPages}
              </span>
              <Button disabled={visitPage >= visitPages} onClick={() => setVisitPage(visitPage + 1)}>
                Next
              </Button>
            </div>
          ) : null}
        </section>
      </div>

      {creating ? (
        <LinkDialog
          open
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            await api.createDocumentLink(id, input);
            await load();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this document?"
        body={`“${doc.name}” will be removed along with its links and all their analytics. This cannot be undone.`}
        confirmLabel="Delete document"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api.deleteDocument(id);
          navigate("/documents");
        }}
      />
    </>
  );
}
