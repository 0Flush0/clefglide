import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./practice/App";
import { LegalNoticeRoute } from "./shared/LegalNotice";
import { configureAndroidLayout } from "./platform/layout";
import "./styles.css";
import "./platform/android.css";
configureAndroidLayout();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LegalNoticeRoute>
      <App />
    </LegalNoticeRoute>
  </React.StrictMode>,
);
