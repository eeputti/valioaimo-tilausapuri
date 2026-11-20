// Ajastin-Worker cf-komentorivityökalulle (sama työkalu kuin deploy/cloudflare). Julkaisu: ks. docs/vercel.md.
import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./worker.mjs" with { type: "cf-worker" };

export default defineConfig({
	accountId: "41cfacacd7c70bbcf80372ab540dd974",
	worker: {
		name: "aimo-whatsapp-tick",
		compatibilityDate: "2026-11-14",
		entrypoint,
		workersDev: false,
		env: { TICK_URL: bindings.secret(), TICK_SECRET: bindings.secret() },
		triggers: [triggers.scheduled({ schedule: "* * * * *" })],
		observability: { enabled: true },
	},
});
