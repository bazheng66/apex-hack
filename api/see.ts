import { seniorFetch } from "../server/senior-api.js"
export default { fetch: (request: Request) => seniorFetch(request, "see", process.env.DEEPSEEK_API_KEY ?? "") }
