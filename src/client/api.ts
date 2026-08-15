// Thin typed fetch layer over the app's own API.

export interface Doc {
  id: string;
  name: string;
  mime: string;
  size_bytes: number;
  page_count: number;
  created_at: string;
  updated_at: string;
  link_count?: number;
  visit_count?: number;
  last_viewed_at?: string | null;
}

export interface Link {
  id: string;
  url: string;
  name: string;
  document_id: string | null;
  dataroom_id: string | null;
  require_email: number;
  has_passcode: boolean;
  allow_list: string;
  deny_list: string;
  watermark: number;
  notify: number;
  agreement_text: string;
  allow_download: number;
  expires_at: string | null;
  is_active: number;
  created_at: string;
  visit_count?: number;
  last_viewed_at?: string | null;
}

export interface LinkInput {
  name?: string;
  require_email?: boolean;
  passcode?: string;
  allow_download?: boolean;
  watermark?: boolean;
  notify?: boolean;
  allow_list?: string;
  deny_list?: string;
  agreement_text?: string;
  expires_at?: string;
  is_active?: boolean;
}

export interface PageStat {
  page: number;
  avg_seconds: number;
  total_seconds: number;
  views: number;
}

export interface DocAnalytics {
  totals: {
    visits: number;
    unique_viewers: number;
    avg_seconds: number;
    total_seconds: number;
    avg_completion: number;
    downloads: number;
  };
  page_count: number;
  per_page: PageStat[];
}

export interface Visit {
  id: string;
  email: string;
  link_id: string;
  link_name: string;
  started_at: string;
  last_seen_at: string;
  total_seconds: number;
  max_page: number;
  completion: number;
  downloaded: number;
}

export interface Dataroom {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  document_count?: number;
  link_count?: number;
  visit_count?: number;
}

export interface RoomFolder {
  id: string;
  name: string;
  position: number;
}

export interface RoomDoc {
  id: string;
  name: string;
  page_count: number;
  size_bytes: number;
  folder_id: string | null;
  position: number;
  added_at: string;
}

export interface RoomDetail extends Dataroom {
  folders: RoomFolder[];
  documents: RoomDoc[];
}

export interface RoomAnalytics {
  totals: { visits: number; document_views: number; total_seconds: number; unique_viewers: number };
  per_document: Array<{
    document_id: string;
    name: string;
    page_count: number;
    views: number;
    avg_seconds: number;
    avg_completion: number;
  }>;
  top_document: { document_id: string; name: string; page_count: number; per_page: PageStat[] } | null;
}

export interface RoomVisit {
  id: string;
  email: string;
  link_id: string;
  link_name: string;
  started_at: string;
  last_seen_at: string | null;
  documents_opened: number;
  total_seconds: number;
  avg_completion: number;
}

export interface Visitor {
  email: string;
  visits: number;
  documents: number;
  total_seconds: number;
  last_seen: string | null;
}

export interface Settings {
  company_name: string;
  accent_color: string;
  has_logo: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  documents: (p?: { page?: number; search?: string }) =>
    request<{ documents: Doc[]; total: number; page: number }>(
      `/api/documents?page=${p?.page ?? 1}${p?.search ? `&search=${encodeURIComponent(p.search)}` : ""}`,
    ),
  document: (id: string) => request<Doc>(`/api/documents/${id}`),
  uploadDocument: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Doc>("/api/documents", { method: "POST", body: form });
  },
  renameDocument: (id: string, name: string) => request<Doc>(`/api/documents/${id}`, json("PATCH", { name })),
  deleteDocument: (id: string) => request<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" }),
  documentAnalytics: (id: string) => request<DocAnalytics>(`/api/documents/${id}/analytics`),
  documentVisits: (id: string, page = 1) =>
    request<{ visits: Visit[]; total: number; page: number }>(`/api/documents/${id}/visits?page=${page}`),
  documentLinks: (id: string) => request<{ links: Link[] }>(`/api/documents/${id}/links`),
  createDocumentLink: (id: string, input: LinkInput) => request<Link>(`/api/documents/${id}/links`, json("POST", input)),

  updateLink: (id: string, input: LinkInput) => request<Link>(`/api/links/${id}`, json("PATCH", input)),
  deleteLink: (id: string) => request<{ ok: boolean }>(`/api/links/${id}`, { method: "DELETE" }),

  datarooms: (p?: { page?: number; search?: string }) =>
    request<{ datarooms: Dataroom[]; total: number; page: number }>(
      `/api/datarooms?page=${p?.page ?? 1}${p?.search ? `&search=${encodeURIComponent(p.search)}` : ""}`,
    ),
  dataroom: (id: string) => request<RoomDetail>(`/api/datarooms/${id}`),
  createDataroom: (input: { name: string; description?: string }) => request<Dataroom>("/api/datarooms", json("POST", input)),
  updateDataroom: (id: string, input: { name?: string; description?: string }) =>
    request<Dataroom>(`/api/datarooms/${id}`, json("PATCH", input)),
  deleteDataroom: (id: string) => request<{ ok: boolean }>(`/api/datarooms/${id}`, { method: "DELETE" }),
  createFolder: (roomId: string, name: string) =>
    request<RoomFolder>(`/api/datarooms/${roomId}/folders`, json("POST", { name })),
  deleteFolder: (id: string) => request<{ ok: boolean }>(`/api/folders/${id}`, { method: "DELETE" }),
  addRoomDocument: (roomId: string, documentId: string, folderId?: string) =>
    request<{ ok: boolean }>(`/api/datarooms/${roomId}/documents`, json("POST", { document_id: documentId, folder_id: folderId })),
  removeRoomDocument: (roomId: string, documentId: string) =>
    request<{ ok: boolean }>(`/api/datarooms/${roomId}/documents/${documentId}`, { method: "DELETE" }),
  roomLinks: (id: string) => request<{ links: Link[] }>(`/api/datarooms/${id}/links`),
  createRoomLink: (id: string, input: LinkInput) => request<Link>(`/api/datarooms/${id}/links`, json("POST", input)),
  roomAnalytics: (id: string) => request<RoomAnalytics>(`/api/datarooms/${id}/analytics`),
  roomVisits: (id: string, page = 1) =>
    request<{ visits: RoomVisit[]; total: number; page: number }>(`/api/datarooms/${id}/visits?page=${page}`),

  visitors: (p?: { page?: number; search?: string }) =>
    request<{ visitors: Visitor[]; total: number; page: number }>(
      `/api/visitors?page=${p?.page ?? 1}${p?.search ? `&search=${encodeURIComponent(p.search)}` : ""}`,
    ),

  settings: () => request<Settings>("/api/settings"),
  saveSettings: (input: { company_name?: string; accent_color?: string }) =>
    request<Settings>("/api/settings", json("PUT", input)),
  uploadLogo: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Settings>("/api/settings/logo", { method: "POST", body: form });
  },
};

// ── Formatting helpers (shared by tables, tiles, chart) ──────────────

/** 95 → "1:35"; 3671 → "1:01:11". Seconds under a minute keep one unit: "42s". */
export function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${m}:${String(rest).padStart(2, "0")}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "—";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}
