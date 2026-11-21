import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./practice/App";
import { LegalNoticeRoute } from "./shared/LegalNotice";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LegalNoticeRoute>
      <App />
    </LegalNoticeRoute>
  </React.StrictMode>,
);
