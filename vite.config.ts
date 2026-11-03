import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { importApi } from "./server/import-api.ts"
import { importV1Api } from "./server/import-v1-api.ts"
import { seniorApi } from "./server/senior-api.ts"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  return {
    plugins: [react(), tailwindcss(), seniorApi(env.DEEPSEEK_API_KEY ?? ""), importApi(), importV1Api(env)],
    server: {
      host: "0.0.0.0",
      port: 4731,
    },
    preview: {
      host: "0.0.0.0",
      port: 4731,
    },
  }
})
