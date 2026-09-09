import type { AppNavItem } from "@clawnify/app/client";

/**
 * The app's destinations, defined once.
 *
 * <AppNav> paints this as the app's own rail when opened directly, and hands
 * the same list to the Clawnify dashboard when embedded there — so the user
 * sees one navigation rather than two, and a phone gets the SDK's strip
 * instead of a drawer this app has to build and keep in sync.
 *
 * Icons come from the platform's TILE_ICONS library; a name outside it draws
 * as a plain dot in the dashboard. Each record type owns a colour and keeps it
 * wherever the type appears.
 */
export const NAV: AppNavItem[] = [
  // Not drawn as a row: the app's name opens it.
  { id: "home", label: "Documents", href: "/documents", home: true },
  { id: "documents", label: "Documents", href: "/documents", icon: "file-text", color: "blue" },
  { id: "datarooms", label: "Data rooms", href: "/datarooms", icon: "folder", color: "amber" },
  { id: "visitors", label: "Visitors", href: "/visitors", icon: "users", color: "violet" },
];

export const SETTINGS: AppNavItem[] = [
  { id: "settings", label: "Settings", href: "/settings", icon: "settings" },
];

/** A detail page keeps its collection's row lit. */
export function activeFor(pathname: string): string {
  if (pathname.startsWith("/datarooms")) return "datarooms";
  if (pathname.startsWith("/visitors")) return "visitors";
  if (pathname.startsWith("/settings")) return "settings";
  return "documents";
}
