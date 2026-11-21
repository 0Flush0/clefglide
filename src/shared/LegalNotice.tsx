import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { LanguageContext, translate, type Language } from "./i18n";

// TODO: Assess whether Section 5 DDG applies to this free, non-monetized service.
// TODO: If applicable, obtain and publish an email address and another suitable
// contact method for rapid electronic contact and direct communication.
// Reference: https://www.gesetze-im-internet.de/ddg/__5.html
export function LegalNoticeRoute({ children }: { children: ReactNode }) {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const language =
    hash === "#/de/impressum"
      ? "de"
      : hash === "#/en/legal-notice"
        ? "en"
        : undefined;
  return language ? <LegalNotice language={language} /> : children;
}

function LegalNotice({ language }: { language: Language }) {
  const tr = (value: string) => translate(value, language);
  useEffect(() => {
    const previousLanguage = document.documentElement.lang;
    document.documentElement.lang = language;
    window.scrollTo(0, 0);
    return () => {
      document.documentElement.lang = previousLanguage;
    };
  }, [language]);
  return (
    <LanguageContext.Provider value={language}>
      <main className="legal-page">
        <a className="legal-back" href="#">
          <ArrowLeft size={16} aria-hidden="true" />
          {tr("Back to ClefGlide")}
        </a>
        <article className="panel legal-card">
          <header className="page-heading">
            <div>
              <span className="eyebrow">ClefGlide</span>
              <h1>{tr("Legal Notice (Impressum)")}</h1>
            </div>
          </header>
          <p>{tr("Information pursuant to Section 18(1) MStV")}</p>
          <address>
            Yashar Zenker
            <br />
            Willi-Graf-Straße 17
            <br />
            {tr("80805 Munich")}
            <br />
            {tr("Germany")}
          </address>
          <nav aria-label="Language">
            <a
              href="#/de/impressum"
              lang="de"
              hrefLang="de"
              aria-current={language === "de" ? "page" : undefined}
            >
              Deutsch
            </a>
            {" · "}
            <a
              href="#/en/legal-notice"
              lang="en"
              hrefLang="en"
              aria-current={language === "en" ? "page" : undefined}
            >
              English
            </a>
          </nav>
        </article>
      </main>
    </LanguageContext.Provider>
  );
}
