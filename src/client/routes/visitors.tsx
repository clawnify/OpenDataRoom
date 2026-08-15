import { useEffect, useState } from "react";
import { api, fmtDuration, timeAgo, type Visitor } from "../api";
import { Button, Empty, Eyebrow, Input, Toolbar } from "../components/ui";

export default function Visitors() {
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(
      () =>
        api
          .visitors({ page, search: search || undefined })
          .then((r) => {
            setVisitors(r.visitors);
            setTotal(r.total);
          })
          .catch(() => {}),
      search ? 250 : 0,
    );
    return () => clearTimeout(t);
  }, [page, search]);

  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <>
      <Toolbar title="Visitors" subtitle={total ? `${total} identified by email` : undefined} />
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <Eyebrow right={`${total}`}>Everyone who viewed</Eyebrow>
          <div className="w-64">
            <Input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by email"
              aria-label="Search visitors"
            />
          </div>
        </div>

        {visitors.length === 0 ? (
          search ? (
            <Empty title={`No visitors match “${search}”`} action={<Button onClick={() => setSearch("")}>Clear search</Button>} />
          ) : (
            <Empty
              title="No identified visitors yet"
              hint="Visitors appear here once someone opens a link that asks for an email."
            />
          )
        ) : (
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="border-y border-border bg-sunken text-left text-xs font-semibold tracking-[0.04em] text-muted">
                  <th className="px-3 py-2.5 first:pl-6">Email</th>
                  <th className="data px-3 py-2.5 text-right">Visits</th>
                  <th className="data px-3 py-2.5 text-right">Documents</th>
                  <th className="data px-3 py-2.5 text-right">Total time</th>
                  <th className="px-3 py-2.5 last:pr-6">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {visitors.map((v) => (
                  <tr key={v.email} className="border-b border-border transition-colors hover:bg-sunken">
                    <td className="px-3 py-2.5 font-medium first:pl-6">{v.email}</td>
                    <td className="data px-3 py-2.5 text-right">{v.visits}</td>
                    <td className="data px-3 py-2.5 text-right">{v.documents}</td>
                    <td className="data px-3 py-2.5 text-right">{fmtDuration(v.total_seconds)}</td>
                    <td className="px-3 py-2.5 text-muted last:pr-6">{timeAgo(v.last_seen)}</td>
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
