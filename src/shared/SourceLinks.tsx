import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "./i18n";
import { licenseReportSchema, type LicenseEntry } from "./licenseReport";

export function GitHubLink() {
  const tr = useTranslation();
  return (
    <a
      className="github-link"
      href="https://github.com/0Flush0/clefglide"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={tr("View source code on GitHub")}
      title={tr("View source code on GitHub")}
    />
  );
}

export function SourceLinks() {
  const tr = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [packages, setPackages] = useState<LicenseEntry[]>();
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const base = import.meta.env.BASE_URL;
  async function load() {
    if (packages || loading) return;
    setFailed(false);
    setLoading(true);
    try {
      const response = await fetch(`${base}licenses/dependencies.json`);
      if (!response.ok) throw new Error("License report unavailable");
      const report = licenseReportSchema.parse(await response.json());
      setPackages(report.packages);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  const filtered = packages?.filter((entry) =>
    `${entry.name} ${entry.license}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="source-links">
      <GitHubLink />
      <button
        className="licenses-link"
        onClick={() => {
          dialog.current?.showModal();
          void load();
        }}
      >
        {tr("Open-source licenses")}
      </button>
      <dialog
        ref={dialog}
        className="licenses-dialog"
        aria-labelledby="licenses-title"
        aria-describedby="licenses-description"
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="licenses-content">
          <div className="licenses-heading">
            <h2 id="licenses-title">{tr("Open-source licenses")}</h2>
            <button
              aria-label={tr("Close licenses")}
              onClick={() => dialog.current?.close()}
              autoFocus
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <p id="licenses-description">
            {tr(
              "Third-party libraries, build tools and fonts have their own licenses. Original notices appear in their published language.",
            )}
          </p>
          <p>
            <a
              href={`${base}licenses/LICENSE.txt`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {tr("Read ClefGlide’s MIT License")}
            </a>
          </p>
          <a
            href={`${base}licenses/THIRD_PARTY_NOTICES.txt`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {tr("Read all notices as plain text")}
          </a>
          {loading && <p role="status">{tr("Loading licenses…")}</p>}
          {failed && (
            <div role="alert">
              <p>{tr("Could not load the license report.")}</p>
              <button onClick={() => void load()}>{tr("Try again")}</button>
            </div>
          )}
          {packages && (
            <>
              <label className="license-search">
                {tr("Search libraries or licenses")}
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="license-entries">
                {filtered?.length === 0 && (
                  <p role="status">{tr("No matching libraries.")}</p>
                )}
                {filtered?.map((entry) => (
                  <details
                    className="license-entry"
                    key={`${entry.name}@${entry.version}`}
                  >
                    <summary>
                      <strong>{entry.name}</strong> <span>{entry.version}</span>
                      {" · "}
                      <span>{entry.license}</span>
                    </summary>
                    {entry.repository && (
                      <a
                        href={entry.repository}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {tr("Repository")}
                      </a>
                    )}
                    {entry.issues.map((issue) => (
                      <p className="license-issue" key={issue}>
                        {tr(issue)}
                      </p>
                    ))}
                    {entry.notices.map((notice) => (
                      <section key={notice.file}>
                        <h3>{notice.file}</h3>
                        <pre>{notice.text}</pre>
                      </section>
                    ))}
                  </details>
                ))}
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
