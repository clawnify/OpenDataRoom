import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppNav, reportLocation } from "@clawnify/app/client";
import { NAV, SETTINGS, activeFor } from "./nav";
import Documents from "./routes/documents";
import DocumentDetail from "./routes/document";
import Datarooms from "./routes/datarooms";
import DataroomDetail from "./routes/dataroom";
import Visitors from "./routes/visitors";
import Settings from "./routes/settings";

export default function App() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  // Lets the dashboard restore this exact screen on reload.
  useEffect(() => {
    reportLocation(pathname + search);
  }, [pathname, search]);

  return (
    /* Column on a phone, row from md: the SDK lays the nav out as a horizontal
       strip under 768px, which only works if the shell stacks it ABOVE the
       content rather than beside it. */
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* flex, so the SDK's <aside> stretches to the row height as a direct
          child would. Below md the SDK renders the same markup as a scrolling
          strip, which is why this app no longer carries a drawer of its own. */}
      <div className="flex shrink-0">
        <AppNav
          title="OpenDataRoom"
          icon="file-text"
          groups={[{ items: NAV }, { label: "Settings", items: SETTINGS }]}
          active={activeFor(pathname)}
          onNavigate={(item) => navigate(item.href ?? "/documents")}
        />
      </div>

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
