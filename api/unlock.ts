import { unlockFetch } from "../server/senior-api.js"

export default {
  fetch(request: Request): Promise<Response> {
    return unlockFetch(request, process.env)
  },
}
