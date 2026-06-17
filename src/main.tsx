import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider } from "./i18n/i18n";
import { WorkspaceProvider } from "./hooks/useWorkspace";
import App from "./App";

function RootApp() {
  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
  }, []);

  return (
    <I18nProvider>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </I18nProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
);
