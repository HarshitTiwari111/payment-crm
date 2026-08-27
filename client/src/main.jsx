import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProvider } from "./context/AppContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ToastProvider } from "./components/Toast";
import { PageActionProvider } from "./components/PageAction";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <AppProvider>
          <PageActionProvider>
            <App />
          </PageActionProvider>
        </AppProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);
