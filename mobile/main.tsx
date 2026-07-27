import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SkyApp } from "../app/SkyApp";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SkyApp />
  </StrictMode>,
);
