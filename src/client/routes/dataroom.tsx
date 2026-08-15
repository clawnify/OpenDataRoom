import { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileText, FolderPlus, Plus, Upload, X } from "lucide-react";
import {
  api,
  fmtDuration,
  timeAgo,
  type Link,
  type RoomAnalytics,
  type RoomDetail,
  type RoomVisit,
} from "../api";
import { PageBarChart } from "../components/chart";
import { LinkDialog, LinksTable } from "../components/links";
import {
  Button,
  Card,
  Chip,
  CompletionRing,
  ConfirmDialog,
  Empty,
  Eyebrow,
  Field,
  Input,
  Modal,
  Segmented,
  Stat,
  Toolbar,
  Zone,
} from "../components/ui";

type Tab = "contents" | "links" | "analytics" | "visitors";

export default function DataroomDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [tab, setTab] = useState<Tab>("contents");
  const [creatingLink, setCreatingLink] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([api.dataroom(id), api.roomLinks(id)]);
      setRoom(r);
      setLinks(l.links);
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (missing) {
    return (
      <>
        <Toolbar title="Data room not found" />
        <Empty title="This data room no longer exists." action={<Button onClick={() => navigate("/datarooms")}>Back to data rooms</Button>} />
      </>
    );
  }
  if (!room) return <Toolbar title="…" />;

  return (
    <>
      <Toolbar
        title={
          <span className="inline-flex items-center gap-2">
            <RouterLink to="/datarooms" aria-label="Back to data rooms" className="rounded-sm p-1 text-muted transition-colors hover:bg-sunken hover:text-foreground">
              <ArrowLeft className="size-4" />
            </RouterLink>
            {room.name}
          </span>
        }
        subtitle={`${room.documents.length} ${room.documents.length === 1 ? "document" : "documents"} · updated ${timeAgo(room.updated_at)}`}
      >
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
        <Button variant="primary" onClick={() => setCreatingLink(true)}>
          <Plus className="size-4" />
          Create link
        </Button>
      </Toolbar>

      <div className="p-6">
        <div className="mb-6">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "contents", label: "Contents" },
              { value: "links", label: "Links" },
              { value: "analytics", label: "Analytics" },
              { value: "visitors", label: "Visitors" },
            ]}
          />
        </div>

        {tab === "contents" ? <Contents room={room} reload={load} /> : null}
        {tab === "links" ? (
          <LinksTable
            links={links}
            onCreateClick={() => setCreatingLink(true)}
            onUpdate={async (linkId, input) => {
              await api.updateLink(linkId, input);
              await load();
            }}
            onDelete={async (linkId) => {
              await api.deleteLink(linkId);
              await load();
            }}
          />
        ) : null}
        {tab === "analytics" ? <Analytics roomId={id} /> : null}
        {tab === "visitors" ? <Visitors roomId={id} /> : null}
      </div>

      {creatingLink ? (
        <LinkDialog
          open
          onClose={() => setCreatingLink(false)}
          onSave={async (input) => {
            await api.createRoomLink(id, input);
            await load();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this data room?"
        body={`“${room.name}”, its links and their visit history will be removed. The documents themselves stay in your library.`}
        confirmLabel="Delete data room"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api.deleteDataroom(id);
          navigate("/datarooms");
        }}
      />
    </>
  );
}

// ── Contents tab: folders + documents ────────────────────────────────

function Contents({ room, reload }: { room: RoomDetail; reload: () => Promise<void> }) {
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [targetFolder, setTargetFolder] = useState<string | undefined>(undefined);
  const [removeDoc, setRemoveDoc] = useState<{ id: string; name: string } | null>(null);
  const [removeFolder, setRemoveFolder] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const doc = await api.uploadDocument(file);
      await api.addRoomDocument(room.id, doc.id, targetFolder);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const addFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderName.trim()) return;
    await api.createFolder(room.id, folderName.trim());
    setFolderName("");
    setAddingFolder(false);
    await reload();
  };

  const section = (folderId: string | null, title: string, deletable?: { id: string; name: string }) => {
    const docs = room.documents.filter((d) => (folderId ? d.folder_id === folderId : !d.folder_id));
    if (folderId === null && docs.length === 0 && room.folders.length === 0) return null;
    return (
      <Zone key={folderId ?? "home"}>
        <Eyebrow
          right={
            deletable ? (
              <button
                type="button"
                aria-label={`Delete folder ${deletable.name}`}
                className="rounded-sm p-0.5 text-faint transition-colors hover:bg-sunken hover:text-danger"
                onClick={() => setRemoveFolder(deletable)}
              >
                <X className="size-3.5" />
              </button>
            ) : (
              `${docs.length}`
            )
          }
        >
          {title}
        </Eyebrow>
        {docs.length === 0 ? (
          <p className="mt-3 text-[0.8125rem] text-faint">
            {folderId ? "Empty — pick this folder in the upload picker above." : "No documents at the room home yet."}
          </p>
        ) : (
          <ul className="mt-3 space-y-1">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-sunken">
                <FileText className="size-4 shrink-0 text-muted" />
                <RouterLink to={`/documents/${d.id}`} className="link min-w-0 truncate font-medium">
                  {d.name}
                </RouterLink>
                <Chip>{d.page_count} pages</Chip>
                <span className="flex-1" />
                <button
                  type="button"
                  aria-label={`Remove ${d.name} from this data room`}
                  className="rounded-sm p-1 text-faint transition-colors hover:bg-sunken hover:text-danger"
                  onClick={() => setRemoveDoc({ id: d.id, name: d.name })}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Zone>
    );
  };

  return (
    <>
      {error ? <p className="mb-4 rounded-sm bg-danger-tint px-3 py-2 text-[0.8125rem] text-danger">{error}</p> : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
        <Button disabled={uploading} onClick={() => fileInput.current?.click()}>
          <Upload className="size-4" />
          {uploading ? "Uploading…" : "Upload document"}
        </Button>
        {room.folders.length ? (
          <select
            aria-label="Upload into folder"
            className="h-8 rounded-sm border border-border bg-surface px-2 text-[0.8125rem] text-foreground focus:border-ring focus:outline-none"
            value={targetFolder ?? ""}
            onChange={(e) => setTargetFolder(e.target.value || undefined)}
          >
            <option value="">into: Room home</option>
            {room.folders.map((f) => (
              <option key={f.id} value={f.id}>
                into: {f.name}
              </option>
            ))}
          </select>
        ) : null}
        <Button onClick={() => setAddingFolder(true)}>
          <FolderPlus className="size-4" />
          Add folder
        </Button>
      </div>

      {room.documents.length === 0 && room.folders.length === 0 ? (
        <Empty
          title="This data room is empty"
          hint="Upload documents (optionally into folders), then create a link to share the whole room."
          action={
            <Button onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" />
              Upload document
            </Button>
          }
        />
      ) : (
        <Card>
          {section(null, "Room home")}
          {room.folders.map((f) =>
            section(f.id, f.name, { id: f.id, name: f.name }),
          )}
        </Card>
      )}

      <Modal open={addingFolder} onClose={() => setAddingFolder(false)} title="Add folder">
        <form onSubmit={addFolder}>
          <div className="p-5">
            <Field label="Folder name">
              <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="e.g. Financials" autoFocus />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button onClick={() => setAddingFolder(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!folderName.trim()}>
              Add folder
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!removeDoc}
        title="Remove from this data room?"
        body={`“${removeDoc?.name}” stays in your library — it only leaves this room.`}
        confirmLabel="Remove document"
        onClose={() => setRemoveDoc(null)}
        onConfirm={async () => {
          if (removeDoc) {
            await api.removeRoomDocument(room.id, removeDoc.id);
            await reload();
          }
        }}
      />
      <ConfirmDialog
        open={!!removeFolder}
        title="Delete this folder?"
        body={`Documents in “${removeFolder?.name}” move to the room home.`}
        confirmLabel="Delete folder"
        onClose={() => setRemoveFolder(null)}
        onConfirm={async () => {
          if (removeFolder) {
            await api.deleteFolder(removeFolder.id);
            await reload();
          }
        }}
      />
    </>
  );
}

// ── Analytics tab ────────────────────────────────────────────────────

function Analytics({ roomId }: { roomId: string }) {
  const [data, setData] = useState<RoomAnalytics | null>(null);
  useEffect(() => {
    api.roomAnalytics(roomId).then(setData).catch(() => {});
  }, [roomId]);
  if (!data) return null;
  const t = data.totals;
  return (
    <div className="space-y-6">
      <Card>
        <Zone>
          <Eyebrow>Room engagement</Eyebrow>
          <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Visits" value={t.visits} meta={`${t.unique_viewers} unique ${t.unique_viewers === 1 ? "viewer" : "viewers"}`} />
            <Stat label="Document views" value={t.document_views} meta="documents opened across visits" />
            <Stat label="Total time" value={fmtDuration(t.total_seconds)} meta="reading time across all visitors" />
            <Stat
              label="Per visit"
              value={t.visits ? fmtDuration(t.total_seconds / t.visits) : "0s"}
              meta="average time per visit"
            />
          </div>
        </Zone>
        {data.top_document && data.top_document.per_page.length ? (
          <Zone>
            <Eyebrow right="avg seconds per page">Most viewed · {data.top_document.name}</Eyebrow>
            <div className="mt-4">
              <PageBarChart perPage={data.top_document.per_page} pageCount={data.top_document.page_count} />
            </div>
          </Zone>
        ) : null}
      </Card>

      <section>
        <div className="mb-3">
          <Eyebrow right={`${data.per_document.length}`}>By document</Eyebrow>
        </div>
        {data.per_document.length === 0 ? (
          <Empty title="No documents in this room yet" />
        ) : (
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="border-y border-border bg-sunken text-left text-xs font-semibold tracking-[0.04em] text-muted">
                  <th className="px-3 py-2.5 first:pl-6">Document</th>
                  <th className="data px-3 py-2.5 text-right">Views</th>
                  <th className="data px-3 py-2.5 text-right">Avg. time</th>
                  <th className="px-3 py-2.5 last:pr-6">Completion</th>
                </tr>
              </thead>
              <tbody>
                {data.per_document.map((d) => (
                  <tr key={d.document_id} className="border-b border-border transition-colors hover:bg-sunken">
                    <td className="px-3 py-2.5 first:pl-6">
                      <RouterLink to={`/documents/${d.document_id}`} className="link font-medium">
                        {d.name}
                      </RouterLink>
                    </td>
                    <td className="data px-3 py-2.5 text-right">{d.views}</td>
                    <td className="data px-3 py-2.5 text-right">{fmtDuration(d.avg_seconds)}</td>
                    <td className="px-3 py-2.5">{d.views ? <CompletionRing fraction={d.avg_completion} /> : <span className="text-faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Visitors tab (the audit log) ─────────────────────────────────────

function Visitors({ roomId }: { roomId: string }) {
  const [visits, setVisits] = useState<RoomVisit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  useEffect(() => {
    api
      .roomVisits(roomId, page)
      .then((r) => {
        setVisits(r.visits);
        setTotal(r.total);
      })
      .catch(() => {});
  }, [roomId, page]);

  if (!visits.length) {
    return <Empty title="No visits yet" hint="Create a link on the Links tab and send it — every open lands here." />;
  }
  const pages = Math.max(1, Math.ceil(total / 25));
  return (
    <>
      <div className="-mx-6 overflow-x-auto">
        <table className="w-full text-[0.8125rem]">
          <thead>
            <tr className="border-y border-border bg-sunken text-left text-xs font-semibold tracking-[0.04em] text-muted">
              <th className="px-3 py-2.5 first:pl-6">Visitor</th>
              <th className="px-3 py-2.5">Link</th>
              <th className="data px-3 py-2.5 text-right">Documents</th>
              <th className="data px-3 py-2.5 text-right">Duration</th>
              <th className="px-3 py-2.5">Completion</th>
              <th className="px-3 py-2.5 last:pr-6">Last viewed</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id} className="border-b border-border transition-colors hover:bg-sunken">
                <td className="px-3 py-2.5 font-medium first:pl-6">{v.email || "Anonymous"}</td>
                <td className="max-w-40 truncate px-3 py-2.5 text-muted">{v.link_name || "Untitled link"}</td>
                <td className="data px-3 py-2.5 text-right">{v.documents_opened}</td>
                <td className="data px-3 py-2.5 text-right">{fmtDuration(v.total_seconds)}</td>
                <td className="px-3 py-2.5">
                  {v.documents_opened ? <CompletionRing fraction={v.avg_completion} /> : <span className="text-faint">—</span>}
                </td>
                <td className="px-3 py-2.5 text-muted last:pr-6">{timeAgo(v.last_seen_at || v.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    </>
  );
}
