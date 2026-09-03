import { useState } from "react";
import { NavLink } from "react-router-dom";
import { FileText, Menu, X } from "lucide-react";
import { NAV } from "../nav";

/**
 * Navigation for screens below `md`, where the sidebar is hidden.
 *
 * Without this the app has no navigation at all on a phone: the sidebar is
 * `hidden md:flex`, so every destination but the current route becomes
 * unreachable. Rendered by Toolbar, which every page already uses, so no route
 * has to opt in.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="-ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunken hover:text-foreground md:hidden"
      >
        <Menu className="size-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-foreground/25"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <nav className="absolute inset-y-0 left-0 flex w-[16.25rem] max-w-[85%] flex-col border-r border-border bg-surface">
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
              <FileText className="size-4 text-primary" strokeWidth={2.5} />
              <span className="text-sm font-semibold">OpenDataRoom</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-2">
              <div className="px-2 py-1.5">
                <span className="eyebrow">Workspace</span>
              </div>
              {NAV.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${
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
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
