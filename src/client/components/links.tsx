// The links table + create/edit dialog, shared by document and data room pages.

import { useState } from "react";
import { Check, Copy, Link as LinkIcon } from "lucide-react";
import { timeAgo, type Link, type LinkInput } from "../api";
import { Badge, Button, Chip, ConfirmDialog, Empty, Field, Input, Modal, Textarea, Toggle } from "./ui";

function isExpired(link: Link): boolean {
  if (!link.expires_at) return false;
  const iso = link.expires_at.endsWith("Z") || link.expires_at.includes("+") ? link.expires_at : link.expires_at + "Z";
  return Date.now() > Date.parse(iso);
}

function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="data truncate text-[0.8125rem] text-muted">{url.replace(/^https?:\/\//, "")}</span>
      <button
        type="button"
        aria-label="Copy link URL"
        title="Copy link URL"
        className="rounded-sm p-1 text-muted transition-colors hover:bg-sunken hover:text-foreground"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-3.5" strokeWidth={2.5} /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}

export function LinkDialog({
  open,
  onClose,
  onSave,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: LinkInput) => Promise<void>;
  /** When set, the dialog edits this link instead of creating one. */
  editing?: Link | null;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [requireEmail, setRequireEmail] = useState(editing ? editing.require_email === 1 : true);
  const [wantPasscode, setWantPasscode] = useState(editing?.has_passcode ?? false);
  const [passcode, setPasscode] = useState("");
  const [allowDownload, setAllowDownload] = useState(editing ? editing.allow_download === 1 : false);
  const [watermark, setWatermark] = useState(editing ? editing.watermark === 1 : false);
  const [notify, setNotify] = useState(editing ? editing.notify === 1 : false);
  const [allowList, setAllowList] = useState(editing?.allow_list ?? "");
  const [agreementText, setAgreementText] = useState(editing?.agreement_text ?? "");
  const [expiresAt, setExpiresAt] = useState(editing?.expires_at ? editing.expires_at.slice(0, 16).replace(" ", "T") : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const input: LinkInput = {
      name: name.trim(),
      require_email: requireEmail,
      allow_download: allowDownload,
      watermark,
      notify,
      allow_list: allowList.trim(),
      agreement_text: agreementText.trim(),
    };
    if (!wantPasscode) {
      if (editing?.has_passcode) input.passcode = "";
    } else if (passcode.trim()) {
      input.passcode = passcode.trim();
    } else if (!editing?.has_passcode) {
      setError("Enter a passcode, or turn the passcode off.");
      setSaving(false);
      return;
    }
    if (expiresAt) input.expires_at = new Date(expiresAt).toISOString();
    else if (editing?.expires_at) input.expires_at = "";
    try {
      await onSave(input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the link. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit link" : "Create link"}>
      <form onSubmit={submit}>
        <div className="space-y-4 p-5">
          {error ? <p className="rounded-sm bg-danger-tint px-2.5 py-1.5 text-[0.8125rem] text-danger">{error}</p> : null}
          <Field label="Name" hint="For your own bookkeeping — visitors never see it.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sequoia — Jane" />
          </Field>
          <div className="space-y-1">
            <Toggle
              label="Require an email address"
              hint="Visitors identify themselves before the first page opens."
              checked={requireEmail}
              onChange={setRequireEmail}
            />
            <Toggle
              label="Require a passcode"
              hint={editing?.has_passcode ? "A passcode is currently set." : undefined}
              checked={wantPasscode}
              onChange={setWantPasscode}
            />
            {wantPasscode ? (
              <Input
                type="text"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder={editing?.has_passcode ? "Leave blank to keep the current passcode" : "Passcode"}
                aria-label="Passcode"
              />
            ) : null}
            <Toggle label="Allow downloading the original file" checked={allowDownload} onChange={setAllowDownload} />
            <Toggle
              label="Watermark pages with the viewer's email"
              hint="A visible deterrent tiled over every page — not copy protection."
              checked={watermark}
              onChange={setWatermark}
            />
            <Toggle
              label="Notify my agent on new visits"
              hint="Your AI employee gets each visit and messages you. Each notification uses one agent turn."
              checked={notify}
              onChange={setNotify}
            />
          </div>
          <Field label="Restrict to" hint="Emails or domains, separated by commas or new lines (e.g. jane@fund.vc, @lp.com). Empty = anyone with the link.">
            <Textarea rows={2} value={allowList} onChange={(e) => setAllowList(e.target.value)} placeholder="jane@fund.vc, @lp.com" />
          </Field>
          <Field label="Agreement" hint="Shown before entry with a required accept checkbox. Empty = no agreement.">
            <Textarea rows={3} value={agreementText} onChange={(e) => setAgreementText(e.target.value)} placeholder="e.g. a short NDA or confidentiality notice" />
          </Field>
          <Field label="Expires" hint="Leave empty for a link that never expires.">
            <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {editing ? "Save link" : "Create link"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function LinksTable({
  links,
  onUpdate,
  onDelete,
  onCreateClick,
}: {
  links: Link[];
  onUpdate: (id: string, input: LinkInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateClick: () => void;
}) {
  const [editing, setEditing] = useState<Link | null>(null);
  const [deleting, setDeleting] = useState<Link | null>(null);

  if (!links.length) {
    return (
      <Empty
        title="No links yet"
        hint="A link is what you send — each one carries its own gates and its own analytics."
        action={<Button onClick={onCreateClick}>Create link</Button>}
      />
    );
  }

  return (
    <>
      <div className="-mx-6 overflow-x-auto">
        <table className="w-full text-[0.8125rem]">
          <thead>
            <tr className="border-y border-border bg-sunken text-left text-xs font-semibold tracking-[0.04em] text-muted">
              <th className="px-3 py-2.5 first:pl-6">Link</th>
              <th className="px-3 py-2.5">URL</th>
              <th className="px-3 py-2.5">Access</th>
              <th className="data px-3 py-2.5 text-right">Views</th>
              <th className="px-3 py-2.5">Last viewed</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 last:pr-6"></th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => {
              const expired = isExpired(l);
              return (
                <tr key={l.id} className="border-b border-border transition-colors hover:bg-sunken">
                  <td className="max-w-48 truncate px-3 py-2.5 font-medium first:pl-6">
                    <span className="inline-flex items-center gap-1.5">
                      <LinkIcon className="size-3.5 shrink-0 text-muted" />
                      {l.name || "Untitled link"}
                    </span>
                  </td>
                  <td className="max-w-72 px-3 py-2.5">
                    <CopyUrl url={l.url} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex flex-wrap gap-1">
                      {l.require_email === 1 ? <Chip>email</Chip> : null}
                      {l.has_passcode ? <Chip>passcode</Chip> : null}
                      {l.allow_list ? <Chip>restricted</Chip> : null}
                      {l.watermark === 1 ? <Chip>watermark</Chip> : null}
                      {l.notify === 1 ? <Chip>notify</Chip> : null}
                      {l.agreement_text ? <Chip>agreement</Chip> : null}
                      {l.allow_download === 1 ? <Chip>download</Chip> : null}
                      {l.expires_at ? <Chip>expires</Chip> : null}
                      {l.require_email !== 1 && !l.has_passcode && !l.allow_list ? <Chip>open</Chip> : null}
                    </span>
                  </td>
                  <td className="data px-3 py-2.5 text-right">{l.visit_count ?? 0}</td>
                  <td className="px-3 py-2.5 text-muted">{timeAgo(l.last_viewed_at)}</td>
                  <td className="px-3 py-2.5">
                    {expired ? (
                      <Badge tone="warning">Expired</Badge>
                    ) : l.is_active === 1 ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge>Off</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right last:pr-6">
                    <span className="inline-flex gap-1">
                      <Button variant="ghost" onClick={() => setEditing(l)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        title={l.is_active === 1 ? "Turn the link off (analytics are kept)" : "Turn the link back on"}
                        onClick={() => onUpdate(l.id, { is_active: l.is_active !== 1 })}
                      >
                        {l.is_active === 1 ? "Turn off" : "Turn on"}
                      </Button>
                      <Button variant="danger" onClick={() => setDeleting(l)}>
                        Delete
                      </Button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing ? (
        <LinkDialog
          key={editing.id}
          open
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={(input) => onUpdate(editing.id, input)}
        />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        title="Delete this link?"
        body={`“${deleting?.name || "Untitled link"}” and its visit history will be removed. To stop access but keep the analytics, turn the link off instead.`}
        confirmLabel="Delete link"
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? onDelete(deleting.id) : undefined)}
      />
    </>
  );
}
