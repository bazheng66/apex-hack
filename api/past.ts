import { seniorFetch } from "../server/senior-api.js"
export default { fetch: (request: Request) => seniorFetch(request, "past", process.env.DEEPSEEK_API_KEY ?? "") }
