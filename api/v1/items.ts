import { vercelFetch } from "../../server/imports/vercel.js"

export default {
  fetch(request: Request): Promise<Response> {
    return vercelFetch(request)
  },
}
