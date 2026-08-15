import { createApp, createRoute, z } from "@clawnify/app";
import { buildVisitBrief, notifyAgent } from "./agent.js";
import { get, query, run } from "./db.js";
import { evaluateGate, makeLinkToken, sha256Hex } from "./gate.js";
import { isPdf, pdfPageCount } from "./pdf.js";
import { unavailablePage, viewerPage } from "./viewer.js";

type Env = {
  Bindings: {
    DB: D1Database;
    /** Per-app R2 bucket holding the uploaded documents and the brand logo. */
    UPLOADS: R2Bucket;
    /** Minted per org by the platform; enables visit notifications to the agent. */
    CLAWNIFY_TOKEN?: string;
    /** Override the platform agent endpoint — local testing only. */
    CLAWNIFY_AGENTS_URL?: string;
  };
};

// createApp bakes in OpenAPIHono construction, the per-request initDB
// middleware and /api/openapi.json + /llms.txt discovery.
const app = createApp<Env>({
  title: "Open DataRoom",
  version: "1.0.0",
  description:
    "Share documents through trackable links. Upload PDFs, create links with email capture, passcodes and expiry, group documents into data rooms, and read page-by-page engagement analytics for every visit.",
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || String(err) }, 500);
});

// ── Shared schemas & helpers ─────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

const PaginationQuery = z.object({
  page: z.string().optional().openapi({ description: "Page number (default: 1)" }),
  limit: z.string().optional().openapi({ description: "Items per page (default: 25, max: 100)" }),
});

function paginate(q: { page?: string; limit?: string }): { limit: number; offset: number; page: number } {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

function ok<T extends z.ZodTypeAny>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}
function fail(description: string) {
  return { description, content: { "application/json": { schema: ErrorSchema } } };
}

const uid = () => crypto.randomUUID();
const origin = (url: string) => new URL(url).origin;

async function countOf(sql: string, params: unknown[] = []): Promise<number> {
  const row = await get<{ n: number }>(sql, params);
  return row?.n ?? 0;
}

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const DocumentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    mime: z.string(),
    size_bytes: z.number().int(),
    page_count: z.number().int(),
    created_at: z.string(),
    updated_at: z.string(),
    link_count: z.number().int().optional(),
    visit_count: z.number().int().optional(),
    last_viewed_at: z.string().nullable().optional(),
  })
  .openapi("Document");

const LinkSchema = z
  .object({
    id: z.string(),
    url: z.string().openapi({ description: "The shareable viewer URL — this is what you send to people" }),
    name: z.string(),
    document_id: z.string().nullable(),
    dataroom_id: z.string().nullable(),
    require_email: z.number().int(),
    has_passcode: z.boolean(),
    allow_list: z.string(),
    deny_list: z.string(),
    watermark: z.number().int(),
    notify: z.number().int(),
    agreement_text: z.string(),
    allow_download: z.number().int(),
    expires_at: z.string().nullable(),
    is_active: z.number().int(),
    created_at: z.string(),
    visit_count: z.number().int().optional(),
    last_viewed_at: z.string().nullable().optional(),
  })
  .openapi("Link");

const LinkInput = z.object({
  name: z.string().optional().openapi({ description: "Label for your own bookkeeping, e.g. 'Sequoia — Jane'" }),
  require_email: z.boolean().optional().openapi({ description: "Ask the viewer for their email before showing the document (default: true)" }),
  passcode: z.string().max(200).optional().openapi({ description: "Optional passcode the viewer must enter" }),
  allow_download: z.boolean().optional().openapi({ description: "Show a download button in the viewer (default: false)" }),
  expires_at: z.string().optional().openapi({ description: "ISO datetime after which the link stops working" }),
  allow_list: z
    .string()
    .max(5000)
    .optional()
    .openapi({ description: "Whitespace/comma-separated emails or @domains; when set, ONLY these may enter (implies the email gate)" }),
  deny_list: z
    .string()
    .max(5000)
    .optional()
    .openapi({ description: "Same format; matching emails are refused. Deny wins over allow" }),
  watermark: z.boolean().optional().openapi({ description: "Overlay the viewer's email on every page (default: false)" }),
  notify: z
    .boolean()
    .optional()
    .openapi({ description: "Notify the org's agent on each new visit (default: false — every notification costs one agent turn)" }),
  agreement_text: z
    .string()
    .max(20000)
    .optional()
    .openapi({ description: "NDA/agreement text the viewer must accept before entering; empty for none" }),
});

type LinkRow = {
  id: string;
  name: string;
  document_id: string | null;
  dataroom_id: string | null;
  require_email: number;
  passcode_hash: string;
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
};

function linkOut(row: LinkRow, requestUrl: string) {
  const { passcode_hash, ...rest } = row;
  return { ...rest, url: `${origin(requestUrl)}/view/${row.id}`, has_passcode: passcode_hash !== "" };
}

const LINK_STATS_SQL = `
  SELECT l.*,
         (SELECT COUNT(*) FROM visits v WHERE v.link_id = l.id) AS visit_count,
         (SELECT MAX(v.started_at) FROM visits v WHERE v.link_id = l.id) AS last_viewed_at
  FROM links l`;

async function createLink(
  target: { document_id?: string; dataroom_id?: string },
  input: z.infer<typeof LinkInput>,
): Promise<string> {
  const id = makeLinkToken();
  await run(
    `INSERT INTO links (id, name, document_id, dataroom_id, require_email, passcode_hash, allow_list, deny_list, watermark, notify, agreement_text, allow_download, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name ?? "",
      target.document_id ?? null,
      target.dataroom_id ?? null,
      input.require_email === false ? 0 : 1,
      input.passcode ? await sha256Hex(input.passcode.trim()) : "",
      input.allow_list ?? "",
      input.deny_list ?? "",
      input.watermark ? 1 : 0,
      input.notify ? 1 : 0,
      input.agreement_text ?? "",
      input.allow_download ? 1 : 0,
      input.expires_at ?? null,
    ],
  );
  return id;
}

// ── Documents ────────────────────────────────────────────────────────

const listDocuments = createRoute({
  method: "get",
  path: "/api/documents",
  tags: ["Documents"],
  summary: "List documents",
  request: {
    query: PaginationQuery.extend({
      search: z.string().optional().openapi({ description: "Filter by name (substring match)" }),
    }),
  },
  responses: {
    200: ok(
      "A page of documents with link/visit counts",
      z.object({ documents: z.array(DocumentSchema), total: z.number().int(), page: z.number().int() }),
    ),
  },
});

app.openapi(listDocuments, async (c) => {
  const q = c.req.valid("query");
  const { limit, offset, page } = paginate(q);
  const search = (q.search ?? "").trim();
  const where = search ? "WHERE d.name LIKE ?" : "";
  const params = search ? [`%${search}%`] : [];
  const documents = await query<Record<string, unknown>>(
    `SELECT d.id, d.name, d.mime, d.size_bytes, d.page_count, d.created_at, d.updated_at,
            (SELECT COUNT(*) FROM links l WHERE l.document_id = d.id) AS link_count,
            (SELECT COUNT(*) FROM document_views dv WHERE dv.document_id = d.id) AS visit_count,
            (SELECT MAX(dv.last_seen_at) FROM document_views dv WHERE dv.document_id = d.id) AS last_viewed_at
     FROM documents d ${where} ORDER BY d.created_at DESC, d.id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = await countOf(`SELECT COUNT(*) AS n FROM documents d ${where}`, params);
  return c.json({ documents, total, page } as never);
});

const uploadDocument = createRoute({
  method: "post",
  path: "/api/documents",
  tags: ["Documents"],
  summary: "Upload a PDF document",
  description:
    "Multipart upload; the `file` field must be a PDF (max 50 MB). The page count is read on upload so analytics can show completion. Non-PDF files are rejected — convert first, then upload.",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any().openapi({ type: "string", format: "binary" }),
            name: z.string().optional().openapi({ description: "Display name (defaults to the filename)" }),
          }),
        },
      },
    },
  },
  responses: {
    201: ok("The stored document", DocumentSchema),
    413: fail("The file is larger than 50 MB"),
    415: fail("Not a PDF"),
    422: fail("The PDF could not be parsed"),
  },
});

app.openapi(uploadDocument, async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "No file in the request" } as never, 415);
  if (!isPdf(file.name, file.type)) {
    return c.json({ error: `${file.name}: only PDF documents are supported. Convert to PDF and upload that.` } as never, 415);
  }
  if (file.size > MAX_PDF_BYTES) return c.json({ error: "The file is larger than 50 MB" } as never, 413);

  const bytes = await file.arrayBuffer();
  let pageCount: number;
  try {
    pageCount = await pdfPageCount(bytes);
  } catch {
    return c.json({ error: "The PDF could not be parsed — it may be corrupt or password-protected." } as never, 422);
  }

  const id = uid();
  const r2Key = `documents/${id}`;
  await c.env.UPLOADS.put(r2Key, bytes, { httpMetadata: { contentType: "application/pdf" } });
  const name = (typeof form.get("name") === "string" && (form.get("name") as string).trim()) || file.name;
  await run(
    "INSERT INTO documents (id, name, r2_key, mime, size_bytes, page_count) VALUES (?, ?, ?, 'application/pdf', ?, ?)",
    [id, name, r2Key, bytes.byteLength, pageCount],
  );
  const doc = await get<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", [id]);
  return c.json(doc as never, 201);
});

const getDocument = createRoute({
  method: "get",
  path: "/api/documents/{id}",
  tags: ["Documents"],
  summary: "One document's metadata and counts",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("The document", DocumentSchema), 404: fail("No such document") },
});

app.openapi(getDocument, async (c) => {
  const { id } = c.req.valid("param");
  const doc = await get<Record<string, unknown>>(
    `SELECT d.id, d.name, d.mime, d.size_bytes, d.page_count, d.created_at, d.updated_at,
            (SELECT COUNT(*) FROM links l WHERE l.document_id = d.id) AS link_count,
            (SELECT COUNT(*) FROM document_views dv WHERE dv.document_id = d.id) AS visit_count,
            (SELECT MAX(dv.last_seen_at) FROM document_views dv WHERE dv.document_id = d.id) AS last_viewed_at
     FROM documents d WHERE d.id = ?`,
    [id],
  );
  if (!doc) return c.json({ error: "No such document" } as never, 404);
  return c.json(doc as never);
});

const renameDocument = createRoute({
  method: "patch",
  path: "/api/documents/{id}",
  tags: ["Documents"],
  summary: "Rename a document",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: z.object({ name: z.string().min(1) }) } } },
  },
  responses: { 200: ok("The updated document", DocumentSchema), 404: fail("No such document") },
});

app.openapi(renameDocument, async (c) => {
  const { id } = c.req.valid("param");
  const { name } = c.req.valid("json");
  const existing = await get("SELECT id FROM documents WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "No such document" } as never, 404);
  await run("UPDATE documents SET name = ?, updated_at = datetime('now') WHERE id = ?", [name.trim(), id]);
  const doc = await get<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", [id]);
  return c.json(doc as never);
});

const deleteDocument = createRoute({
  method: "delete",
  path: "/api/documents/{id}",
  tags: ["Documents"],
  summary: "Delete a document, its links and its analytics",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("Deleted", OkSchema), 404: fail("No such document") },
});

app.openapi(deleteDocument, async (c) => {
  const { id } = c.req.valid("param");
  const doc = await get<{ r2_key: string }>("SELECT r2_key FROM documents WHERE id = ?", [id]);
  if (!doc) return c.json({ error: "No such document" } as never, 404);

  // Explicit dependent deletes, leaf-first, so the outcome doesn't depend on
  // whether foreign-key cascade enforcement is on in this SQLite build.
  await run(
    `DELETE FROM page_views WHERE view_id IN (SELECT id FROM document_views WHERE document_id = ?)`,
    [id],
  );
  await run("DELETE FROM document_views WHERE document_id = ?", [id]);
  await run(
    `DELETE FROM visits WHERE link_id IN (SELECT id FROM links WHERE document_id = ?)`,
    [id],
  );
  await run("DELETE FROM links WHERE document_id = ?", [id]);
  await run("DELETE FROM dataroom_documents WHERE document_id = ?", [id]);
  await run("DELETE FROM documents WHERE id = ?", [id]);
  await c.env.UPLOADS.delete(doc.r2_key);
  return c.json({ ok: true } as never);
});

// Dashboard-side file preview (the public viewer uses /api/view/... instead).
const documentFile = createRoute({
  method: "get",
  path: "/api/documents/{id}/file",
  tags: ["Documents"],
  summary: "The original PDF bytes",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: "The PDF" }, 404: fail("No such document") },
});

app.openapi(documentFile, async (c) => {
  const { id } = c.req.valid("param");
  const doc = await get<{ r2_key: string; name: string }>("SELECT r2_key, name FROM documents WHERE id = ?", [id]);
  if (!doc) return c.json({ error: "No such document" } as never, 404);
  const obj = await c.env.UPLOADS.get(doc.r2_key);
  if (!obj) return c.json({ error: "The stored file is missing" } as never, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.name.replace(/[^\w.\- ]+/g, "_")}"`,
    },
  });
});

// ── Document links ───────────────────────────────────────────────────

const listDocumentLinks = createRoute({
  method: "get",
  path: "/api/documents/{id}/links",
  tags: ["Links"],
  summary: "Share links for a document",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("All links for this document", z.object({ links: z.array(LinkSchema) })), 404: fail("No such document") },
});

app.openapi(listDocumentLinks, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await get("SELECT id FROM documents WHERE id = ?", [id]))) {
    return c.json({ error: "No such document" } as never, 404);
  }
  const rows = await query<LinkRow>(`${LINK_STATS_SQL} WHERE l.document_id = ? ORDER BY l.created_at DESC`, [id]);
  return c.json({ links: rows.map((r) => linkOut(r, c.req.url)) } as never);
});

const createDocumentLink = createRoute({
  method: "post",
  path: "/api/documents/{id}/links",
  tags: ["Links"],
  summary: "Create a share link for a document",
  description:
    "Returns the link including its public `url`. Defaults: email required, no passcode, downloads off, never expires.",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: LinkInput } } },
  },
  responses: { 201: ok("The created link", LinkSchema), 404: fail("No such document") },
});

app.openapi(createDocumentLink, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await get("SELECT id FROM documents WHERE id = ?", [id]))) {
    return c.json({ error: "No such document" } as never, 404);
  }
  const linkId = await createLink({ document_id: id }, c.req.valid("json"));
  const row = await get<LinkRow>(`${LINK_STATS_SQL} WHERE l.id = ?`, [linkId]);
  return c.json(linkOut(row!, c.req.url) as never, 201);
});

const updateLink = createRoute({
  method: "patch",
  path: "/api/links/{id}",
  tags: ["Links"],
  summary: "Update a link's settings",
  description:
    "Any subset of fields. `passcode: \"\"` removes the passcode; `expires_at: \"\"` removes the expiry; `is_active: false` turns the link off without deleting its analytics.",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: LinkInput.extend({
            is_active: z.boolean().optional(),
            passcode: z.string().max(200).optional(),
            expires_at: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: { 200: ok("The updated link", LinkSchema), 404: fail("No such link") },
});

app.openapi(updateLink, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const existing = await get<LinkRow>("SELECT * FROM links WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "No such link" } as never, 404);

  const passcodeHash =
    body.passcode === undefined
      ? existing.passcode_hash
      : body.passcode.trim() === ""
        ? ""
        : await sha256Hex(body.passcode.trim());

  await run(
    `UPDATE links SET name = ?, require_email = ?, passcode_hash = ?, allow_list = ?, deny_list = ?, watermark = ?, notify = ?, agreement_text = ?, allow_download = ?, expires_at = ?, is_active = ? WHERE id = ?`,
    [
      body.name ?? existing.name,
      body.require_email === undefined ? existing.require_email : body.require_email ? 1 : 0,
      passcodeHash,
      body.allow_list ?? existing.allow_list,
      body.deny_list ?? existing.deny_list,
      body.watermark === undefined ? existing.watermark : body.watermark ? 1 : 0,
      body.notify === undefined ? existing.notify : body.notify ? 1 : 0,
      body.agreement_text ?? existing.agreement_text,
      body.allow_download === undefined ? existing.allow_download : body.allow_download ? 1 : 0,
      body.expires_at === undefined ? existing.expires_at : body.expires_at === "" ? null : body.expires_at,
      body.is_active === undefined ? existing.is_active : body.is_active ? 1 : 0,
      id,
    ],
  );
  const row = await get<LinkRow>(`${LINK_STATS_SQL} WHERE l.id = ?`, [id]);
  return c.json(linkOut(row!, c.req.url) as never);
});

const deleteLink = createRoute({
  method: "delete",
  path: "/api/links/{id}",
  tags: ["Links"],
  summary: "Delete a link and its visit history",
  description: "Prefer PATCH { is_active: false } to keep the analytics — deletion removes the visits too.",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("Deleted", OkSchema), 404: fail("No such link") },
});

app.openapi(deleteLink, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await get("SELECT id FROM links WHERE id = ?", [id]))) return c.json({ error: "No such link" } as never, 404);
  await run(
    `DELETE FROM page_views WHERE view_id IN (
       SELECT dv.id FROM document_views dv JOIN visits v ON v.id = dv.visit_id WHERE v.link_id = ?)`,
    [id],
  );
  await run("DELETE FROM document_views WHERE visit_id IN (SELECT id FROM visits WHERE link_id = ?)", [id]);
  await run("DELETE FROM visits WHERE link_id = ?", [id]);
  await run("DELETE FROM links WHERE id = ?", [id]);
  return c.json({ ok: true } as never);
});

// ── Document analytics ───────────────────────────────────────────────

const PageStat = z
  .object({
    page: z.number().int(),
    avg_seconds: z.number(),
    total_seconds: z.number(),
    views: z.number().int(),
  })
  .openapi("PageStat");

const documentAnalytics = createRoute({
  method: "get",
  path: "/api/documents/{id}/analytics",
  tags: ["Analytics"],
  summary: "Engagement analytics for a document",
  description:
    "Totals plus average reading time per page. `avg_completion` is 0..1 — the average share of the document a visit reached.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: ok(
      "Analytics",
      z.object({
        totals: z.object({
          visits: z.number().int(),
          unique_viewers: z.number().int(),
          avg_seconds: z.number(),
          total_seconds: z.number(),
          avg_completion: z.number(),
          downloads: z.number().int(),
        }),
        page_count: z.number().int(),
        per_page: z.array(PageStat),
      }),
    ),
    404: fail("No such document"),
  },
});

app.openapi(documentAnalytics, async (c) => {
  const { id } = c.req.valid("param");
  const doc = await get<{ page_count: number }>("SELECT page_count FROM documents WHERE id = ?", [id]);
  if (!doc) return c.json({ error: "No such document" } as never, 404);

  const totals = await get<Record<string, number>>(
    `SELECT COUNT(*) AS visits,
            COUNT(DISTINCT CASE WHEN v.email <> '' THEN v.email END) AS unique_viewers,
            COALESCE(AVG(dv.total_seconds), 0) AS avg_seconds,
            COALESCE(SUM(dv.total_seconds), 0) AS total_seconds,
            COALESCE(AVG(MIN(1.0 * dv.max_page / NULLIF(?, 0), 1)), 0) AS avg_completion,
            COALESCE(SUM(dv.downloaded), 0) AS downloads
     FROM document_views dv JOIN visits v ON v.id = dv.visit_id
     WHERE dv.document_id = ?`,
    [doc.page_count, id],
  );
  const perPage = await query<{ page: number; total_seconds: number; views: number }>(
    `SELECT pv.page AS page, SUM(pv.seconds) AS total_seconds, COUNT(*) AS views
     FROM page_views pv JOIN document_views dv ON dv.id = pv.view_id
     WHERE dv.document_id = ? GROUP BY pv.page ORDER BY pv.page`,
    [id],
  );
  return c.json({
    totals,
    page_count: doc.page_count,
    per_page: perPage.map((p) => ({ ...p, avg_seconds: p.views ? p.total_seconds / p.views : 0 })),
  } as never);
});

const VisitSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    link_id: z.string(),
    link_name: z.string(),
    started_at: z.string(),
    last_seen_at: z.string(),
    total_seconds: z.number(),
    max_page: z.number().int(),
    completion: z.number().openapi({ description: "0..1 share of the document reached" }),
    downloaded: z.number().int(),
  })
  .openapi("Visit");

const documentVisits = createRoute({
  method: "get",
  path: "/api/documents/{id}/visits",
  tags: ["Analytics"],
  summary: "Individual visits to a document",
  request: { params: z.object({ id: z.string() }), query: PaginationQuery },
  responses: {
    200: ok("A page of visits, newest first", z.object({ visits: z.array(VisitSchema), total: z.number().int(), page: z.number().int() })),
    404: fail("No such document"),
  },
});

app.openapi(documentVisits, async (c) => {
  const { id } = c.req.valid("param");
  const doc = await get<{ page_count: number }>("SELECT page_count FROM documents WHERE id = ?", [id]);
  if (!doc) return c.json({ error: "No such document" } as never, 404);
  const { limit, offset, page } = paginate(c.req.valid("query"));
  const rows = await query<Record<string, unknown>>(
    `SELECT dv.id, v.email, v.link_id, l.name AS link_name, dv.started_at, dv.last_seen_at,
            dv.total_seconds, dv.max_page, dv.downloaded,
            MIN(1.0 * dv.max_page / NULLIF(?, 0), 1) AS completion
     FROM document_views dv
     JOIN visits v ON v.id = dv.visit_id
     JOIN links l ON l.id = v.link_id
     WHERE dv.document_id = ?
     ORDER BY dv.started_at DESC, dv.id LIMIT ? OFFSET ?`,
    [doc.page_count, id, limit, offset],
  );
  const total = await countOf("SELECT COUNT(*) AS n FROM document_views WHERE document_id = ?", [id]);
  return c.json({ visits: rows, total, page } as never);
});

// ── Data rooms ───────────────────────────────────────────────────────

const DataroomSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    document_count: z.number().int().optional(),
    link_count: z.number().int().optional(),
    visit_count: z.number().int().optional(),
  })
  .openapi("Dataroom");

const listDatarooms = createRoute({
  method: "get",
  path: "/api/datarooms",
  tags: ["Data rooms"],
  summary: "List data rooms",
  request: { query: PaginationQuery.extend({ search: z.string().optional() }) },
  responses: {
    200: ok("A page of data rooms", z.object({ datarooms: z.array(DataroomSchema), total: z.number().int(), page: z.number().int() })),
  },
});

app.openapi(listDatarooms, async (c) => {
  const q = c.req.valid("query");
  const { limit, offset, page } = paginate(q);
  const search = (q.search ?? "").trim();
  const where = search ? "WHERE r.name LIKE ?" : "";
  const params = search ? [`%${search}%`] : [];
  const datarooms = await query<Record<string, unknown>>(
    `SELECT r.*,
            (SELECT COUNT(*) FROM dataroom_documents rd WHERE rd.dataroom_id = r.id) AS document_count,
            (SELECT COUNT(*) FROM links l WHERE l.dataroom_id = r.id) AS link_count,
            (SELECT COUNT(*) FROM visits v JOIN links l ON l.id = v.link_id WHERE l.dataroom_id = r.id) AS visit_count
     FROM datarooms r ${where} ORDER BY r.updated_at DESC, r.id LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = await countOf(`SELECT COUNT(*) AS n FROM datarooms r ${where}`, params);
  return c.json({ datarooms, total, page } as never);
});

const createDataroom = createRoute({
  method: "post",
  path: "/api/datarooms",
  tags: ["Data rooms"],
  summary: "Create a data room",
  request: {
    body: {
      content: {
        "application/json": { schema: z.object({ name: z.string().min(1), description: z.string().optional() }) },
      },
    },
  },
  responses: { 201: ok("The created data room", DataroomSchema) },
});

app.openapi(createDataroom, async (c) => {
  const body = c.req.valid("json");
  const id = uid();
  await run("INSERT INTO datarooms (id, name, description) VALUES (?, ?, ?)", [id, body.name.trim(), body.description ?? ""]);
  const room = await get<Record<string, unknown>>("SELECT * FROM datarooms WHERE id = ?", [id]);
  return c.json(room as never, 201);
});

const RoomDocument = z
  .object({
    id: z.string(),
    name: z.string(),
    page_count: z.number().int(),
    size_bytes: z.number().int(),
    folder_id: z.string().nullable(),
    position: z.number().int(),
    added_at: z.string(),
  })
  .openapi("RoomDocument");

const RoomFolder = z
  .object({ id: z.string(), name: z.string(), position: z.number().int() })
  .openapi("RoomFolder");

const getDataroom = createRoute({
  method: "get",
  path: "/api/datarooms/{id}",
  tags: ["Data rooms"],
  summary: "A data room with its folders and documents",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: ok(
      "The data room",
      DataroomSchema.extend({ folders: z.array(RoomFolder), documents: z.array(RoomDocument) }),
    ),
    404: fail("No such data room"),
  },
});

app.openapi(getDataroom, async (c) => {
  const { id } = c.req.valid("param");
  const room = await get<Record<string, unknown>>("SELECT * FROM datarooms WHERE id = ?", [id]);
  if (!room) return c.json({ error: "No such data room" } as never, 404);
  const folders = await query<Record<string, unknown>>(
    "SELECT id, name, position FROM dataroom_folders WHERE dataroom_id = ? ORDER BY position, created_at",
    [id],
  );
  const documents = await query<Record<string, unknown>>(
    `SELECT d.id, d.name, d.page_count, d.size_bytes, rd.folder_id, rd.position, rd.added_at
     FROM dataroom_documents rd JOIN documents d ON d.id = rd.document_id
     WHERE rd.dataroom_id = ? ORDER BY rd.position, rd.added_at`,
    [id],
  );
  return c.json({ ...room, folders, documents } as never);
});

const updateDataroom = createRoute({
  method: "patch",
  path: "/api/datarooms/{id}",
  tags: ["Data rooms"],
  summary: "Rename a data room or edit its description",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { "application/json": { schema: z.object({ name: z.string().min(1).optional(), description: z.string().optional() }) } },
    },
  },
  responses: { 200: ok("The updated data room", DataroomSchema), 404: fail("No such data room") },
});

app.openapi(updateDataroom, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const room = await get<{ name: string; description: string }>("SELECT * FROM datarooms WHERE id = ?", [id]);
  if (!room) return c.json({ error: "No such data room" } as never, 404);
  await run("UPDATE datarooms SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?", [
    body.name?.trim() || room.name,
    body.description ?? room.description,
    id,
  ]);
  const updated = await get<Record<string, unknown>>("SELECT * FROM datarooms WHERE id = ?", [id]);
  return c.json(updated as never);
});

const deleteDataroom = createRoute({
  method: "delete",
  path: "/api/datarooms/{id}",
  tags: ["Data rooms"],
  summary: "Delete a data room, its links and their visit history",
  description: "The documents themselves are kept — they still exist in the library and in other rooms.",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("Deleted", OkSchema), 404: fail("No such data room") },
});

app.openapi(deleteDataroom, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await get("SELECT id FROM datarooms WHERE id = ?", [id]))) {
    return c.json({ error: "No such data room" } as never, 404);
  }
  await run(
    `DELETE FROM page_views WHERE view_id IN (
       SELECT dv.id FROM document_views dv JOIN visits v ON v.id = dv.visit_id
       JOIN links l ON l.id = v.link_id WHERE l.dataroom_id = ?)`,
    [id],
  );
  await run(
    `DELETE FROM document_views WHERE visit_id IN (
       SELECT v.id FROM visits v JOIN links l ON l.id = v.link_id WHERE l.dataroom_id = ?)`,
    [id],
  );
  await run("DELETE FROM visits WHERE link_id IN (SELECT id FROM links WHERE dataroom_id = ?)", [id]);
  await run("DELETE FROM links WHERE dataroom_id = ?", [id]);
  await run("DELETE FROM dataroom_documents WHERE dataroom_id = ?", [id]);
  await run("DELETE FROM dataroom_folders WHERE dataroom_id = ?", [id]);
  await run("DELETE FROM datarooms WHERE id = ?", [id]);
  return c.json({ ok: true } as never);
});

const createFolder = createRoute({
  method: "post",
  path: "/api/datarooms/{id}/folders",
  tags: ["Data rooms"],
  summary: "Add a folder to a data room",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: z.object({ name: z.string().min(1) }) } } },
  },
  responses: { 201: ok("The created folder", RoomFolder), 404: fail("No such data room") },
});

app.openapi(createFolder, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await get("SELECT id FROM datarooms WHERE id = ?", [id]))) {
    return c.json({ error: "No such data room" } as never, 404);
  }
  const folderId = uid();
  const pos = await countOf("SELECT COUNT(*) AS n FROM dataroom_folders WHERE dataroom_id = ?", [id]);
  await run("INSERT INTO dataroom_folders (id, dataroom_id, name, position) VALUES (?, ?, ?, ?)", [
    folderId,
    id,
    c.req.valid("json").name.trim(),
    pos,
  ]);
  await run("UPDATE datarooms SET updated_at = datetime('now') WHERE id = ?", [id]);
  const folder = await get<Record<string, unknown>>("SELECT id, name, position FROM dataroom_folders WHERE id = ?", [folderId]);
  return c.json(folder as never, 201);
});

const deleteFolder = createRoute({
  method: "delete",
  path: "/api/folders/{id}",
  tags: ["Data rooms"],
  summary: "Delete a folder (its documents move to the room home)",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("Deleted", OkSchema), 404: fail("No such folder") },
});

app.openapi(deleteFolder, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await get("SELECT id FROM dataroom_folders WHERE id = ?", [id]))) {
    return c.json({ error: "No such folder" } as never, 404);
  }
  await run("UPDATE dataroom_documents SET folder_id = NULL WHERE folder_id = ?", [id]);
  await run("DELETE FROM dataroom_folders WHERE id = ?", [id]);
  return c.json({ ok: true } as never);
});

const addRoomDocument = createRoute({
  method: "post",
  path: "/api/datarooms/{id}/documents",
  tags: ["Data rooms"],
  summary: "Add an existing document to a data room",
  description: "Upload documents via POST /api/documents first, then add them here (optionally into a folder).",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ document_id: z.string(), folder_id: z.string().optional() }),
        },
      },
    },
  },
  responses: { 200: ok("Added", OkSchema), 404: fail("No such data room, document or folder") },
});

app.openapi(addRoomDocument, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  if (!(await get("SELECT id FROM datarooms WHERE id = ?", [id]))) {
    return c.json({ error: "No such data room" } as never, 404);
  }
  if (!(await get("SELECT id FROM documents WHERE id = ?", [body.document_id]))) {
    return c.json({ error: "No such document" } as never, 404);
  }
  if (body.folder_id && !(await get("SELECT id FROM dataroom_folders WHERE id = ? AND dataroom_id = ?", [body.folder_id, id]))) {
    return c.json({ error: "No such folder in this data room" } as never, 404);
  }
  const pos = await countOf("SELECT COUNT(*) AS n FROM dataroom_documents WHERE dataroom_id = ?", [id]);
  await run(
    `INSERT INTO dataroom_documents (dataroom_id, document_id, folder_id, position) VALUES (?, ?, ?, ?)
     ON CONFLICT (dataroom_id, document_id) DO UPDATE SET folder_id = excluded.folder_id`,
    [id, body.document_id, body.folder_id ?? null, pos],
  );
  await run("UPDATE datarooms SET updated_at = datetime('now') WHERE id = ?", [id]);
  return c.json({ ok: true } as never);
});

const removeRoomDocument = createRoute({
  method: "delete",
  path: "/api/datarooms/{id}/documents/{docId}",
  tags: ["Data rooms"],
  summary: "Remove a document from a data room (the document itself is kept)",
  request: { params: z.object({ id: z.string(), docId: z.string() }) },
  responses: { 200: ok("Removed", OkSchema), 404: fail("Not in this data room") },
});

app.openapi(removeRoomDocument, async (c) => {
  const { id, docId } = c.req.valid("param");
  const row = await get("SELECT dataroom_id FROM dataroom_documents WHERE dataroom_id = ? AND document_id = ?", [id, docId]);
  if (!row) return c.json({ error: "Not in this data room" } as never, 404);
  await run("DELETE FROM dataroom_documents WHERE dataroom_id = ? AND document_id = ?", [id, docId]);
  await run("UPDATE datarooms SET updated_at = datetime('now') WHERE id = ?", [id]);
  return c.json({ ok: true } as never);
});

// ── Data room links & analytics ──────────────────────────────────────

const listRoomLinks = createRoute({
  method: "get",
  path: "/api/datarooms/{id}/links",
  tags: ["Links"],
  summary: "Share links for a data room",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("All links for this room", z.object({ links: z.array(LinkSchema) })), 404: fail("No such data room") },
});

app.openapi(listRoomLinks, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await get("SELECT id FROM datarooms WHERE id = ?", [id]))) {
    return c.json({ error: "No such data room" } as never, 404);
  }
  const rows = await query<LinkRow>(`${LINK_STATS_SQL} WHERE l.dataroom_id = ? ORDER BY l.created_at DESC`, [id]);
  return c.json({ links: rows.map((r) => linkOut(r, c.req.url)) } as never);
});

const createRoomLink = createRoute({
  method: "post",
  path: "/api/datarooms/{id}/links",
  tags: ["Links"],
  summary: "Create a share link for a data room",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: LinkInput } } },
  },
  responses: { 201: ok("The created link", LinkSchema), 404: fail("No such data room") },
});

app.openapi(createRoomLink, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await get("SELECT id FROM datarooms WHERE id = ?", [id]))) {
    return c.json({ error: "No such data room" } as never, 404);
  }
  const linkId = await createLink({ dataroom_id: id }, c.req.valid("json"));
  const row = await get<LinkRow>(`${LINK_STATS_SQL} WHERE l.id = ?`, [linkId]);
  return c.json(linkOut(row!, c.req.url) as never, 201);
});

const dataroomAnalytics = createRoute({
  method: "get",
  path: "/api/datarooms/{id}/analytics",
  tags: ["Analytics"],
  summary: "Engagement analytics for a data room",
  description: "Room totals, per-document engagement, and the page-by-page profile of the most-viewed document.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: ok(
      "Analytics",
      z.object({
        totals: z.object({
          visits: z.number().int(),
          document_views: z.number().int(),
          total_seconds: z.number(),
          unique_viewers: z.number().int(),
        }),
        per_document: z.array(
          z.object({
            document_id: z.string(),
            name: z.string(),
            page_count: z.number().int(),
            views: z.number().int(),
            avg_seconds: z.number(),
            avg_completion: z.number(),
          }),
        ),
        top_document: z
          .object({ document_id: z.string(), name: z.string(), page_count: z.number().int(), per_page: z.array(PageStat) })
          .nullable(),
      }),
    ),
    404: fail("No such data room"),
  },
});

app.openapi(dataroomAnalytics, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await get("SELECT id FROM datarooms WHERE id = ?", [id]))) {
    return c.json({ error: "No such data room" } as never, 404);
  }
  const totals = await get<Record<string, number>>(
    `SELECT (SELECT COUNT(*) FROM visits v JOIN links l ON l.id = v.link_id WHERE l.dataroom_id = ?) AS visits,
            (SELECT COUNT(DISTINCT CASE WHEN v.email <> '' THEN v.email END)
               FROM visits v JOIN links l ON l.id = v.link_id WHERE l.dataroom_id = ?) AS unique_viewers,
            COUNT(dv.id) AS document_views,
            COALESCE(SUM(dv.total_seconds), 0) AS total_seconds
     FROM document_views dv
     JOIN visits v ON v.id = dv.visit_id
     JOIN links l ON l.id = v.link_id
     WHERE l.dataroom_id = ?`,
    [id, id, id],
  );
  const perDocument = await query<{ document_id: string; name: string; page_count: number; views: number; avg_seconds: number; avg_completion: number }>(
    `SELECT d.id AS document_id, d.name, d.page_count,
            COUNT(dv.id) AS views,
            COALESCE(AVG(dv.total_seconds), 0) AS avg_seconds,
            COALESCE(AVG(MIN(1.0 * dv.max_page / NULLIF(d.page_count, 0), 1)), 0) AS avg_completion
     FROM dataroom_documents rd
     JOIN documents d ON d.id = rd.document_id
     LEFT JOIN document_views dv ON dv.document_id = d.id
       AND dv.visit_id IN (SELECT v.id FROM visits v JOIN links l ON l.id = v.link_id WHERE l.dataroom_id = ?)
     WHERE rd.dataroom_id = ?
     GROUP BY d.id ORDER BY views DESC, d.name`,
    [id, id],
  );
  let topDocument = null;
  const top = perDocument.find((d) => d.views > 0);
  if (top) {
    const perPage = await query<{ page: number; total_seconds: number; views: number }>(
      `SELECT pv.page AS page, SUM(pv.seconds) AS total_seconds, COUNT(*) AS views
       FROM page_views pv
       JOIN document_views dv ON dv.id = pv.view_id
       JOIN visits v ON v.id = dv.visit_id
       JOIN links l ON l.id = v.link_id
       WHERE dv.document_id = ? AND l.dataroom_id = ?
       GROUP BY pv.page ORDER BY pv.page`,
      [top.document_id, id],
    );
    topDocument = {
      document_id: top.document_id,
      name: top.name,
      page_count: top.page_count,
      per_page: perPage.map((p) => ({ ...p, avg_seconds: p.views ? p.total_seconds / p.views : 0 })),
    };
  }
  return c.json({ totals, per_document: perDocument, top_document: topDocument } as never);
});

const RoomVisit = z
  .object({
    id: z.string(),
    email: z.string(),
    link_id: z.string(),
    link_name: z.string(),
    started_at: z.string(),
    last_seen_at: z.string().nullable(),
    documents_opened: z.number().int(),
    total_seconds: z.number(),
    avg_completion: z.number(),
  })
  .openapi("RoomVisit");

const dataroomVisits = createRoute({
  method: "get",
  path: "/api/datarooms/{id}/visits",
  tags: ["Analytics"],
  summary: "Individual visits to a data room",
  request: { params: z.object({ id: z.string() }), query: PaginationQuery },
  responses: {
    200: ok("A page of visits, newest first", z.object({ visits: z.array(RoomVisit), total: z.number().int(), page: z.number().int() })),
    404: fail("No such data room"),
  },
});

app.openapi(dataroomVisits, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await get("SELECT id FROM datarooms WHERE id = ?", [id]))) {
    return c.json({ error: "No such data room" } as never, 404);
  }
  const { limit, offset, page } = paginate(c.req.valid("query"));
  const rows = await query<Record<string, unknown>>(
    `SELECT v.id, v.email, v.link_id, l.name AS link_name, v.started_at,
            MAX(dv.last_seen_at) AS last_seen_at,
            COUNT(dv.id) AS documents_opened,
            COALESCE(SUM(dv.total_seconds), 0) AS total_seconds,
            COALESCE(AVG(MIN(1.0 * dv.max_page / NULLIF(d.page_count, 0), 1)), 0) AS avg_completion
     FROM visits v
     JOIN links l ON l.id = v.link_id
     LEFT JOIN document_views dv ON dv.visit_id = v.id
     LEFT JOIN documents d ON d.id = dv.document_id
     WHERE l.dataroom_id = ?
     GROUP BY v.id ORDER BY v.started_at DESC, v.id LIMIT ? OFFSET ?`,
    [id, limit, offset],
  );
  const total = await countOf(
    "SELECT COUNT(*) AS n FROM visits v JOIN links l ON l.id = v.link_id WHERE l.dataroom_id = ?",
    [id],
  );
  return c.json({ visits: rows, total, page } as never);
});

// ── Visitors (global, grouped by email) ──────────────────────────────

const VisitorSchema = z
  .object({
    email: z.string(),
    visits: z.number().int(),
    documents: z.number().int(),
    total_seconds: z.number(),
    last_seen: z.string().nullable(),
  })
  .openapi("Visitor");

const listVisitors = createRoute({
  method: "get",
  path: "/api/visitors",
  tags: ["Analytics"],
  summary: "Everyone who has viewed anything, grouped by email",
  request: { query: PaginationQuery.extend({ search: z.string().optional() }) },
  responses: {
    200: ok("A page of visitors", z.object({ visitors: z.array(VisitorSchema), total: z.number().int(), page: z.number().int() })),
  },
});

app.openapi(listVisitors, async (c) => {
  const q = c.req.valid("query");
  const { limit, offset, page } = paginate(q);
  const search = (q.search ?? "").trim();
  const where = search ? "AND v.email LIKE ?" : "";
  const params = search ? [`%${search}%`] : [];
  const visitors = await query<Record<string, unknown>>(
    `SELECT v.email,
            COUNT(DISTINCT v.id) AS visits,
            COUNT(DISTINCT dv.document_id) AS documents,
            COALESCE(SUM(dv.total_seconds), 0) AS total_seconds,
            MAX(COALESCE(dv.last_seen_at, v.started_at)) AS last_seen
     FROM visits v LEFT JOIN document_views dv ON dv.visit_id = v.id
     WHERE v.email <> '' ${where}
     GROUP BY v.email ORDER BY last_seen DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = await countOf(
    `SELECT COUNT(DISTINCT v.email) AS n FROM visits v WHERE v.email <> '' ${where}`,
    params,
  );
  return c.json({ visitors, total, page } as never);
});

// ── Settings (branding for the public viewer) ────────────────────────

const SettingsSchema = z
  .object({
    company_name: z.string(),
    accent_color: z.string(),
    has_logo: z.boolean(),
  })
  .openapi("Settings");

async function readSettings() {
  const row = await get<{ company_name: string; logo_key: string; accent_color: string }>(
    "SELECT company_name, logo_key, accent_color FROM settings WHERE id = 1",
  );
  return row ?? { company_name: "", logo_key: "", accent_color: "" };
}

const getSettings = createRoute({
  method: "get",
  path: "/api/settings",
  tags: ["Settings"],
  summary: "Branding shown on the public viewer",
  responses: { 200: ok("The settings", SettingsSchema) },
});

app.openapi(getSettings, async (c) => {
  const s = await readSettings();
  return c.json({ company_name: s.company_name, accent_color: s.accent_color, has_logo: s.logo_key !== "" } as never);
});

const putSettings = createRoute({
  method: "put",
  path: "/api/settings",
  tags: ["Settings"],
  summary: "Update branding",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            company_name: z.string().max(200).optional(),
            accent_color: z
              .string()
              .regex(/^(#[0-9a-fA-F]{3,8})?$/, "hex color like #1A6E63, or empty to reset")
              .optional(),
          }),
        },
      },
    },
  },
  responses: { 200: ok("The settings", SettingsSchema) },
});

app.openapi(putSettings, async (c) => {
  const body = c.req.valid("json");
  const s = await readSettings();
  await run("UPDATE settings SET company_name = ?, accent_color = ? WHERE id = 1", [
    body.company_name ?? s.company_name,
    body.accent_color ?? s.accent_color,
  ]);
  const next = await readSettings();
  return c.json({ company_name: next.company_name, accent_color: next.accent_color, has_logo: next.logo_key !== "" } as never);
});

const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

const uploadLogo = createRoute({
  method: "post",
  path: "/api/settings/logo",
  tags: ["Settings"],
  summary: "Upload the brand logo shown on the public viewer",
  request: {
    body: {
      content: {
        "multipart/form-data": { schema: z.object({ file: z.any().openapi({ type: "string", format: "binary" }) }) },
      },
    },
  },
  responses: { 200: ok("The settings", SettingsSchema), 413: fail("Larger than 2 MB"), 415: fail("Not an image") },
});

app.openapi(uploadLogo, async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !LOGO_TYPES[file.type]) {
    return c.json({ error: "Upload a PNG, JPEG, SVG or WebP image." } as never, 415);
  }
  if (file.size > MAX_LOGO_BYTES) return c.json({ error: "The logo must be 2 MB or smaller." } as never, 413);
  const key = "branding/logo";
  await c.env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await run("UPDATE settings SET logo_key = ? WHERE id = 1", [key]);
  const s = await readSettings();
  return c.json({ company_name: s.company_name, accent_color: s.accent_color, has_logo: true } as never);
});

// Dashboard-side logo preview (the viewer fetches it via /api/view/{link}/logo).
app.get("/api/settings/logo", async (c) => {
  const s = await readSettings();
  if (!s.logo_key) return c.json({ error: "No logo uploaded" }, 404);
  const obj = await c.env.UPLOADS.get(s.logo_key);
  if (!obj) return c.json({ error: "No logo uploaded" }, 404);
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType ?? "image/png", "Cache-Control": "no-store" },
  });
});

// ═════════════════════════════════════════════════════════════════════
// Public viewer surface — the ONLY routes reachable without platform auth
// (declared in clawnify.json api.public_routes: GET /view/*, /api/view/**).
// Deliberately plain Hono routes, off the OpenAPI/discovery surface: the
// agent manages links through the API above; visitors just follow a URL.
// ═════════════════════════════════════════════════════════════════════

type FullLinkRow = LinkRow & { doc_name?: string; room_name?: string };

async function loadLink(id: string): Promise<FullLinkRow | undefined> {
  return get<FullLinkRow>(
    `SELECT l.*, d.name AS doc_name, r.name AS room_name
     FROM links l
     LEFT JOIN documents d ON d.id = l.document_id
     LEFT JOIN datarooms r ON r.id = l.dataroom_id
     WHERE l.id = ?`,
    [id],
  );
}

app.get("/view/:linkId", async (c) => {
  const link = await loadLink(c.req.param("linkId"));
  if (!link) return c.html(unavailablePage("This link does not exist."), 404);
  if (!link.is_active) return c.html(unavailablePage("This link has been deactivated."), 410);
  if (link.expires_at && Date.now() > Date.parse(link.expires_at + (link.expires_at.endsWith("Z") ? "" : "Z"))) {
    return c.html(unavailablePage("This link has expired."), 410);
  }
  const s = await readSettings();
  return c.html(
    viewerPage({
      linkId: link.id,
      kind: link.document_id ? "document" : "dataroom",
      name: (link.document_id ? link.doc_name : link.room_name) ?? "Shared documents",
      requireEmail: link.require_email === 1 || link.allow_list.trim() !== "",
      hasPasscode: link.passcode_hash !== "",
      agreementText: link.agreement_text,
      brand: { companyName: s.company_name, accentColor: s.accent_color, hasLogo: s.logo_key !== "" },
    }),
  );
});

app.post("/api/view/:linkId/session", async (c) => {
  const link = await loadLink(c.req.param("linkId"));
  let body: { email?: string; passcode?: string; agreed?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    /* empty body is fine when the link has no gates */
  }
  const verdict = await evaluateGate(link ?? null, body);
  if (!verdict.ok) return c.json({ error: verdict.error }, verdict.status);

  const visitId = uid();
  await run("INSERT INTO visits (id, link_id, email, user_agent, agreed_at) VALUES (?, ?, ?, ?, ?)", [
    visitId,
    link!.id,
    verdict.email,
    (c.req.header("user-agent") ?? "").slice(0, 300),
    link!.agreement_text?.trim() ? new Date().toISOString() : null,
  ]);

  // Exactly one dispatch per visit, after the response is sent — a lost
  // notification never blocks or slows the visitor.
  if (link!.notify === 1) {
    const brief = buildVisitBrief({
      viewerEmail: verdict.email,
      targetKind: link!.document_id ? "document" : "data room",
      targetName: (link!.document_id ? link!.doc_name : link!.room_name) ?? "Shared documents",
      linkName: link!.name,
      documentId: link!.document_id,
    });
    c.executionCtx.waitUntil(notifyAgent(c.env, brief));
  }

  const common = {
    visit_id: visitId,
    allow_download: link!.allow_download === 1,
    watermark: link!.watermark === 1 ? verdict.email || "Confidential" : "",
  };

  if (link!.document_id) {
    const doc = await get<{ id: string; name: string; page_count: number }>(
      "SELECT id, name, page_count FROM documents WHERE id = ?",
      [link!.document_id],
    );
    return c.json({
      ...common,
      folders: [],
      documents: doc ? [{ ...doc, folder_id: null }] : [],
    });
  }

  const folders = await query<{ id: string; name: string }>(
    "SELECT id, name FROM dataroom_folders WHERE dataroom_id = ? ORDER BY position, created_at",
    [link!.dataroom_id],
  );
  const documents = await query<{ id: string; name: string; page_count: number; folder_id: string | null }>(
    `SELECT d.id, d.name, d.page_count, rd.folder_id
     FROM dataroom_documents rd JOIN documents d ON d.id = rd.document_id
     WHERE rd.dataroom_id = ? ORDER BY rd.position, rd.added_at`,
    [link!.dataroom_id],
  );
  return c.json({ ...common, folders, documents });
});

/** A visit is only usable with the link it was created for, and only while the link stays open. */
async function usableVisit(linkId: string, visitId: string): Promise<{ link: FullLinkRow } | { error: string; status: 401 | 404 | 410 }> {
  const link = await loadLink(linkId);
  if (!link) return { error: "This link does not exist.", status: 404 };
  if (!link.is_active) return { error: "This link has been deactivated.", status: 410 };
  if (link.expires_at && Date.now() > Date.parse(link.expires_at + (link.expires_at.endsWith("Z") ? "" : "Z"))) {
    return { error: "This link has expired.", status: 410 };
  }
  const visit = await get("SELECT id FROM visits WHERE id = ? AND link_id = ?", [visitId, linkId]);
  if (!visit) return { error: "Open the link again to continue.", status: 401 };
  return { link };
}

/** Is this document reachable through this link? */
async function documentInLink(link: FullLinkRow, documentId: string): Promise<boolean> {
  if (link.document_id) return link.document_id === documentId;
  const row = await get("SELECT document_id FROM dataroom_documents WHERE dataroom_id = ? AND document_id = ?", [
    link.dataroom_id,
    documentId,
  ]);
  return !!row;
}

app.post("/api/view/:linkId/open", async (c) => {
  let body: { visit_id?: string; document_id?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Malformed request" }, 400);
  }
  if (!body.visit_id || !body.document_id) return c.json({ error: "Malformed request" }, 400);

  const gate = await usableVisit(c.req.param("linkId"), body.visit_id);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (!(await documentInLink(gate.link, body.document_id))) {
    return c.json({ error: "This document is not part of this link." }, 404);
  }
  const viewId = uid();
  await run("INSERT INTO document_views (id, visit_id, document_id) VALUES (?, ?, ?)", [
    viewId,
    body.visit_id,
    body.document_id,
  ]);
  return c.json({ view_id: viewId });
});

app.get("/api/view/:linkId/file", async (c) => {
  const viewId = c.req.query("view_id") ?? "";
  const view = await get<{ visit_id: string; document_id: string }>(
    "SELECT visit_id, document_id FROM document_views WHERE id = ?",
    [viewId],
  );
  if (!view) return c.json({ error: "Open the link again to continue." }, 401);
  const gate = await usableVisit(c.req.param("linkId"), view.visit_id);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (!(await documentInLink(gate.link, view.document_id))) return c.json({ error: "Not found" }, 404);

  const doc = await get<{ r2_key: string }>("SELECT r2_key FROM documents WHERE id = ?", [view.document_id]);
  const obj = doc && (await c.env.UPLOADS.get(doc.r2_key));
  if (!obj) return c.json({ error: "The stored file is missing." }, 404);
  return new Response(obj.body, {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
  });
});

app.get("/api/view/:linkId/download", async (c) => {
  const viewId = c.req.query("view_id") ?? "";
  const view = await get<{ id: string; visit_id: string; document_id: string }>(
    "SELECT id, visit_id, document_id FROM document_views WHERE id = ?",
    [viewId],
  );
  if (!view) return c.json({ error: "Open the link again to continue." }, 401);
  const gate = await usableVisit(c.req.param("linkId"), view.visit_id);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (gate.link.allow_download !== 1) return c.json({ error: "Downloads are not allowed on this link." }, 403);
  if (!(await documentInLink(gate.link, view.document_id))) return c.json({ error: "Not found" }, 404);

  const doc = await get<{ r2_key: string; name: string }>("SELECT r2_key, name FROM documents WHERE id = ?", [view.document_id]);
  const obj = doc && (await c.env.UPLOADS.get(doc.r2_key));
  if (!doc || !obj) return c.json({ error: "The stored file is missing." }, 404);
  await run("UPDATE document_views SET downloaded = downloaded + 1 WHERE id = ?", [view.id]);
  const filename = doc.name.replace(/[^\w.\- ]+/g, "_").replace(/\.pdf$/i, "") + ".pdf";
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

app.post("/api/view/:linkId/beat", async (c) => {
  // sendBeacon may arrive as text/plain — parse the raw text, not the content type.
  let body: { view_id?: string; pages?: Array<{ page: number; seconds: number }> };
  try {
    body = JSON.parse(await c.req.text());
  } catch {
    return c.json({ error: "Malformed request" }, 400);
  }
  const viewId = body.view_id ?? "";
  const pages = Array.isArray(body.pages) ? body.pages.slice(0, 100) : [];
  if (!viewId || !pages.length) return c.json({ ok: true });

  const view = await get<{ id: string; visit_id: string }>(
    "SELECT id, visit_id FROM document_views WHERE id = ?",
    [viewId],
  );
  if (!view) return c.json({ error: "Unknown view" }, 401);
  const gate = await usableVisit(c.req.param("linkId"), view.visit_id);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  let maxPage = 0;
  for (const p of pages) {
    const page = Math.floor(Number(p.page));
    const seconds = Number(p.seconds);
    if (!Number.isFinite(page) || page < 1 || page > 5000) continue;
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    const clamped = Math.min(seconds, 3600);
    maxPage = Math.max(maxPage, page);
    await run(
      `INSERT INTO page_views (view_id, page, seconds) VALUES (?, ?, ?)
       ON CONFLICT (view_id, page) DO UPDATE SET seconds = seconds + excluded.seconds`,
      [viewId, page, clamped],
    );
  }
  await run(
    `UPDATE document_views SET
       total_seconds = (SELECT COALESCE(SUM(seconds), 0) FROM page_views WHERE view_id = ?),
       max_page = MAX(max_page, ?),
       last_seen_at = datetime('now')
     WHERE id = ?`,
    [viewId, maxPage, viewId],
  );
  return c.json({ ok: true });
});

app.get("/api/view/:linkId/logo", async (c) => {
  const link = await loadLink(c.req.param("linkId"));
  if (!link) return c.json({ error: "Not found" }, 404);
  const s = await readSettings();
  if (!s.logo_key) return c.json({ error: "Not found" }, 404);
  const obj = await c.env.UPLOADS.get(s.logo_key);
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType ?? "image/png", "Cache-Control": "public, max-age=300" },
  });
});

export default app;
