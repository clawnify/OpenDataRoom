import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./app";
import "./styles.css";

// Agent mode: larger targets, no hover-only affordances (handled in CSS/markup).
const params = new URLSearchParams(location.search);
if (params.has("agent") || params.get("mode") === "agent") {
  document.documentElement.dataset.agent = "true";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
