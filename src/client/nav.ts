import { FileText, FolderOpen, Settings2, Users } from "lucide-react";

/**
 * The workspace destinations. Shared by the desktop sidebar (app.tsx) and the
 * mobile drawer (components/mobile-nav.tsx) so the two can never disagree
 * about what the app contains.
 */
export const NAV = [
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/datarooms", label: "Data rooms", icon: FolderOpen },
  { to: "/visitors", label: "Visitors", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings2 },
];
