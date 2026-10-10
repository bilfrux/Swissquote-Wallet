import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./wallet.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
