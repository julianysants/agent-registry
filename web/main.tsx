import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

const el = document.getElementById("root");
if (!el) throw new Error("no se encontró #root");
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
