import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { FileText } from "lucide-react";
import { NAV } from "./nav";
import Documents from "./routes/documents";
import DocumentDetail from "./routes/document";
import Datarooms from "./routes/datarooms";
import DataroomDetail from "./routes/dataroom";
import Visitors from "./routes/visitors";
import Settings from "./routes/settings";

export default function App() {
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-[16.25rem] shrink-0 flex-col border-r border-border bg-surface md:flex">
        {/* h-14 here and on Toolbar: the sidebar brand row and the page header
            must share one height so their bottom borders form a single
            unbroken line across the app. */}
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <FileText className="size-4 text-primary" strokeWidth={2.5} />
          <span className="text-sm font-semibold">OpenDataRoom</span>
        </div>
        <nav className="p-2">
          <div className="px-2 py-1.5">
            <span className="eyebrow">Workspace</span>
          </div>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] font-semibold text-primary"
                    : "text-foreground hover:bg-sunken"
                }`
              }
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/documents" replace />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/documents/:id" element={<DocumentDetail />} />
          <Route path="/datarooms" element={<Datarooms />} />
          <Route path="/datarooms/:id" element={<DataroomDetail />} />
          <Route path="/visitors" element={<Visitors />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
