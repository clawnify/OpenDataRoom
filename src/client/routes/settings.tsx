import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { api, type Settings as SettingsData } from "../api";
import { Button, Card, Eyebrow, Field, Input, Toolbar, Zone } from "../components/ui";

export default function Settings() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [logoBust, setLogoBust] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.settings().then((s) => {
      setSettings(s);
      setCompanyName(s.company_name);
      setAccentColor(s.accent_color);
    });
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    try {
      const s = await api.saveSettings({ company_name: companyName.trim(), accent_color: accentColor.trim() });
      setSettings(s);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
    }
  };

  const uploadLogo = async (file: File) => {
    setStatus("saving");
    try {
      const s = await api.uploadLogo(file);
      setSettings(s);
      setLogoBust(Date.now());
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
    }
  };

  if (!settings) return <Toolbar title="Settings" />;

  return (
    <>
      <Toolbar title="Settings" subtitle="Branding shown to visitors on the public viewer" />
      <div className="max-w-2xl p-6">
        <form onSubmit={save}>
          <Card>
            <Zone>
              <Eyebrow>Branding</Eyebrow>
              <div className="mt-4 space-y-4">
                <Field label="Company name" hint="Shown in the viewer header and on data room covers.">
                  <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Northwind Capital" />
                </Field>
                <Field label="Accent color" hint="Hex color for the viewer's accents — the gate bar, buttons and data room cover.">
                  <span className="flex items-center gap-2">
                    {/* design-lint: allow — an example of the hex a USER types for their own brand, not a colour this app paints with. */}
                    <Input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} placeholder="#1A6E63" className="max-w-40" />
                    <span
                      aria-hidden="true"
                      className="inline-block size-6 rounded-sm border border-border"
                      style={{ background: /^#[0-9a-fA-F]{3,8}$/.test(accentColor) ? accentColor : "var(--sunken)" }}
                    />
                  </span>
                </Field>
              </div>
            </Zone>
            <Zone>
              <Eyebrow>Logo</Eyebrow>
              <div className="mt-4 flex items-center gap-4">
                {settings.has_logo ? (
                  <img
                    src={`/api/settings/logo?t=${logoBust}`}
                    alt="Current logo"
                    className="h-8 w-auto rounded-sm border border-border bg-surface p-1"
                  />
                ) : (
                  <span className="text-[0.8125rem] text-faint">No logo uploaded</span>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadLogo(f);
                    e.target.value = "";
                  }}
                />
                <Button onClick={() => fileInput.current?.click()}>
                  <Upload className="size-4" />
                  {settings.has_logo ? "Replace logo" : "Upload logo"}
                </Button>
              </div>
              <p className="mt-2 text-[0.6875rem] text-faint">PNG, JPEG, SVG or WebP, up to 2 MB. Shown at 24px tall.</p>
            </Zone>
            <Zone>
              <div className="flex items-center justify-between">
                <span className="text-[0.8125rem] text-muted" role="status">
                  {status === "saved" ? "Saved." : status === "error" ? "Unable to save. Check the accent color and try again." : " "}
                </span>
                <Button type="submit" variant="primary" disabled={status === "saving"}>
                  Save branding
                </Button>
              </div>
            </Zone>
          </Card>
        </form>
      </div>
    </>
  );
}
