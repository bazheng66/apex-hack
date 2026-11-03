import { handleImportsApi } from "./http.js"

export function vercelFetch(request: Request): Promise<Response> {
  return handleImportsApi(request, { env: { ...process.env } })
}
