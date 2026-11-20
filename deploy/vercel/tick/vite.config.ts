import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// Ajastin-Worker: pelkkä Worker ilman sivuja (cf deploy käyttää Viteä).
export default defineConfig({ plugins: [cloudflare()] });
