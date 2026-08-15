import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { api, timeAgo, type Dataroom } from "../api";
import { Button, Empty, Eyebrow, Field, Input, Modal, Toolbar } from "../components/ui";

export default function Datarooms() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Dataroom[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (p: number) => {
    const res = await api.datarooms({ page: p });
    setRooms(res.datarooms);
    setTotal(res.total);
  }, []);

  useEffect(() => {
    load(page).catch(() => setError("Unable to load data rooms. Reload to try again."));
  }, [page, load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const room = await api.createDataroom({ name: name.trim(), description: description.trim() || undefined });
      navigate(`/datarooms/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create the data room.");
      setSaving(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <>
      <Toolbar title="Data rooms" subtitle={total ? `${total} total` : undefined}>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New data room
        </Button>
      </Toolbar>

      <div className="p-6">
        {error ? <p className="mb-4 rounded-sm bg-danger-tint px-3 py-2 text-[0.8125rem] text-danger">{error}</p> : null}
        <div className="mb-4">
          <Eyebrow right={`${total}`}>Rooms</Eyebrow>
        </div>

        {rooms.length === 0 ? (
          <Empty
            title="No data rooms yet"
            hint="A data room bundles documents behind one link — folders, branding and per-visitor analytics included."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                New data room
              </Button>
            }
          />
        ) : (
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="border-y border-border bg-sunken text-left text-xs font-semibold tracking-[0.04em] text-muted">
                  <th className="px-3 py-2.5 first:pl-6">Name</th>
                  <th className="data px-3 py-2.5 text-right">Documents</th>
                  <th className="data px-3 py-2.5 text-right">Links</th>
                  <th className="data px-3 py-2.5 text-right">Visits</th>
                  <th className="px-3 py-2.5 last:pr-6">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-border transition-colors hover:bg-sunken"
                    onClick={() => navigate(`/datarooms/${r.id}`)}
                  >
                    <td className="px-3 py-2.5 first:pl-6">
                      <span className="block max-w-md truncate font-medium">{r.name}</span>
                      {r.description ? <span className="block max-w-md truncate text-xs text-muted">{r.description}</span> : null}
                    </td>
                    <td className="data px-3 py-2.5 text-right">{r.document_count ?? 0}</td>
                    <td className="data px-3 py-2.5 text-right">{r.link_count ?? 0}</td>
                    <td className="data px-3 py-2.5 text-right">{r.visit_count ?? 0}</td>
                    <td className="px-3 py-2.5 text-muted last:pr-6">{timeAgo(r.updated_at)}</td>
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

      <Modal open={creating} onClose={() => setCreating(false)} title="New data room">
        <form onSubmit={create}>
          <div className="space-y-4 p-5">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Series B — diligence" autoFocus />
            </Field>
            <Field label="Description" hint="Optional. Shown only in the dashboard.">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this room is for" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving || !name.trim()}>
              Create data room
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
