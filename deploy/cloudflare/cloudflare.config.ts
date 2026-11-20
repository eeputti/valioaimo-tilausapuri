import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	accountId: "41cfacacd7c70bbcf80372ab540dd974",
	worker: {
		name: "aimo-order-demo",
		compatibilityDate: "2026-11-14",
		entrypoint,
		workersDev: true,
		env: { DB: bindings.d1({ id: "fd216575-282d-48a4-a2f9-d01f528aab19", name: "aimo-order-demo" }), SYNC_TOKEN: bindings.secret(), WEBCHAT_SECRET: bindings.secret(), DEMO_PAYMENTS_ENABLED: bindings.text("true") },
		observability: { enabled: true, redactQueryString: true,
			logs: { enabled: true, headSamplingRate: 0.1 },
			traces: { enabled: true, headSamplingRate: 0.1 } },
	},
});
