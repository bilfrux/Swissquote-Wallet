import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Console du tiers de confiance : appli séparée de l'app cliente et de bank-mock (port propre).
export default defineConfig({ envDir: "..", plugins: [react()], server: { port: 5174 } });
