import type { IncomingMessage } from "node:http"
import type { Connect, Plugin } from "vite"
import { questionsFromModel, safePageUrl, visionReading } from "../src/engine/extract.ts"
import { readLimitedBody } from "./imports/http.js"

const SYSTEM = [
  "你是 Testpass，负责 AI 考试通过助手。",
  "用中文，两到四句，平静、具体。",
  "不要鸡汤，不要表情符号，不要称呼对方为亲。",
  "不要加新的考试章节，不要改我给你的分数、分钟和对错。",
  "分数已经由规则算完，你只把错法和今天该做什么说清楚。",
  "材料不够就说材料不够，不要编造题目或分数。",
].join("")

type SeniorBody = Record<string, unknown>
interface JsonResponse {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(body: string): unknown
}

export async function seniorFetch(request: Request, route: "senior" | "see" | "past", apiKey: string): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } })
  let result: Response | undefined
  const headers = new Headers({ "cache-control": "no-store" })
  const response: JsonResponse = {
    statusCode: 200,
    setHeader: (name, value) => headers.set(name, value),
    end: (body) => { result = new Response(body, { status: response.statusCode, headers }) },
  }
  await (route === "senior" ? handle : route === "see" ? seeImage : findPast)(request, response, apiKey)
  return result ?? Response.json({ error: "No response" }, { status: 502 })
}

export function seniorApi(apiKey: string): Plugin {
  const attach = (middlewares: Connect.Server) => {
    middlewares.use("/api/senior", (request, response, next) => {
      if (request.method !== "POST") {
        next()
        return
      }
      void handle(request, response, apiKey)
    })
    middlewares.use("/api/see", (request, response, next) => {
      if (request.method !== "POST") {
        next()
        return
      }
      void seeImage(request, response, apiKey)
    })
    middlewares.use("/api/past", (request, response, next) => {
      if (request.method !== "POST") {
        next()
        return
      }
      void findPast(request, response, apiKey)
    })
  }

  return {
    name: "senior-api",
    configureServer(server) {
      attach(server.middlewares)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}

async function handle(request: IncomingMessage | Request, response: JsonResponse, apiKey: string) {
  try {
    const body = await readJson(request)
    const prompt = promptFor(body)
    if (!prompt) {
      send(response, 400, { error: "评语材料不完整" })
      return
    }
    if (!apiKey) {
      send(response, 503, { error: "未配置密钥" })
      return
    }
    const raw = await complete(apiKey, prompt)
    const line = clip(body.kind, 20) === "today" ? tighten(raw) : raw
    send(response, 200, { line })
  } catch {
    send(response, 502, { error: "Testpass 暂时没有写成" })
  }
}

function promptFor(body: SeniorBody): string | null {
  const kind = clip(body.kind, 20)
  if (kind === "today") {
    return [
      "写今天对这位同学说的话。",
      "只写一句 20 到 34 个字的话：今天做什么、为什么是它。",
      "不要解释，不要提材料不足，不要分点，不要复述任务原文。",
      `考试：${clip(body.exam, 40)}`,
      `水平：${clip(body.levelVoice, 80)}`,
      `专项：${clip(body.topic, 40)}，当前 ${clip(body.score, 8)}`,
      `状态：${clip(body.status, 20)}，${clip(body.minutes, 8)} 分钟`,
      `任务：${clip(body.instruction, 300)}`,
      `规则依据：${clip(body.reason, 300)}`,
    ].join("\n")
  }
  if (kind === "review") {
    const items = Array.isArray(body.items) ? body.items.slice(0, 4) : []
    if (items.length === 0) return null
    const lines = items.map((item, index) => {
      const row = item && typeof item === "object" ? (item as SeniorBody) : {}
      return `${index + 1}. ${clip(row.topic, 40)}，${clip(row.correct, 8) === "true" ? "对" : "错"}。题干：${clip(row.prompt, 240)}。所选：${clip(row.chosen, 160)}。说明：${clip(row.note, 240)}`
    })
    return [`考试：${clip(body.exam, 40)}`, "这套题刚刚交卷。按每题的对错写一段总评，点出最该记住的一个错法。", ...lines].join("\n")
  }
  if (kind === "upload") {
    return [
      "同学交来一份自己做过的模拟。",
      `考试：${clip(body.exam, 40)}`,
      `知识点：${clip(body.topic, 40)}`,
      `结果：${clip(body.correct, 8)}/${clip(body.total, 8)}，这块现在是 ${clip(body.score, 8)}`,
      `同学写的错法：${clip(body.mistake, 300) || "没有写"}`,
      `规则已经给出的结论：${clip(body.ruleLine, 300)}`,
    ].join("\n")
  }
  if (kind === "talk") {
    const history = Array.isArray(body.history) ? body.history.slice(-6) : []
    const earlier = history.map((item) => {
      const row = item && typeof item === "object" ? (item as SeniorBody) : {}
      const who = clip(row.role, 10) === "user" ? "同学" : "Testpass"
      return `${who}：${clip(row.text, 240)}`
    })
    const text = clip(body.text, 400)
    if (!text) return null
    return [
      "接着这场考试的对话往下说。",
      `考试：${clip(body.exam, 40)}`,
      `当前专项：${clip(body.topic, 40)}，分数 ${clip(body.score, 8)}`,
      earlier.length ? `之前：\n${earlier.join("\n")}` : "之前还没有对话。",
      `同学现在说：${text}`,
    ].join("\n")
  }
  return null
}

async function seeImage(request: IncomingMessage | Request, response: JsonResponse, apiKey: string) {
  try {
    const body = await readJson(request, 8_000_000)
    const image = clip(body.image, 7_000_000)
    if (!/^data:image\/(jpeg|png|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(image)) {
      send(response, 400, { error: "请上传 JPEG、PNG、GIF 或 WebP。" })
      return
    }
    if (!apiKey) {
      send(response, 503, { error: "未配置密钥" })
      return
    }
    const raw = await completeVision(
      apiKey,
      [
        `考试：${clip(body.exam, 40)}。专项：${clip(body.topic, 40)}。`,
        clip(body.note, 200) ? `同学补了一句：${clip(body.note, 200)}` : "同学没有补文字。",
        "读这张卷面或错题照片。只输出 JSON：{\"seen\":\"读到的题干，看不清就空字符串\",\"comment\":\"两句评语\"}。",
        "看不清就在 comment 里说看不清。不要编造卷面上没有的题目，也不要改分数。",
      ].join("\n"),
      image,
    )
    const reading = visionReading(raw)
    send(response, 200, reading)
  } catch {
    send(response, 502, { error: "这张图暂时没有看清" })
  }
}

async function findPast(request: IncomingMessage | Request, response: JsonResponse, apiKey: string) {
  try {
    const body = await readJson(request, 20_000)
    const exam = clip(body.exam, 40)
    const topic = clip(body.topic, 40)
    if (!exam || !topic) {
      send(response, 400, { error: "还不知道要找哪一场的题" })
      return
    }
    if (!apiKey) {
      send(response, 503, { error: "未配置密钥" })
      return
    }
    const query = `${exam} ${topic} 期末真题`.slice(0, 128)
    const searched = await postJson(apiKey, "https://api.deepseek.com/v1/tools/search", {
      query,
      count: 5,
      ori_question: `找一道可以核对来源的${exam}${topic}真题`,
      need_content: false,
    })
    const results = Array.isArray(searched.results) ? searched.results : []
    const ordered = [...results].sort((a, b) => scoreSource(a) - scoreSource(b))
    for (const result of ordered.slice(0, 4)) {
      if (!result || typeof result !== "object") continue
      const row = result as SeniorBody
      const url = safePageUrl(clip(row.url, 2000).split("#")[0] ?? "")
      if (!url) continue
      let page: SeniorBody
      try {
        page = await postJson(apiKey, "https://api.deepseek.com/v1/tools/fetch", { url })
      } catch {
        continue
      }
      const content = clip(page.content, 7000)
      if (content.length < 80) continue
      const raw = await complete(
        apiKey,
        [
          "下面是抓到的公开网页正文。只抽取正文里真正出现的题干，最多两道。",
          "不要补写网页里没有的选项、答案或解析。没有完整题干就返回 {\"found\":false,\"questions\":[]}。",
          "只输出 JSON：{\"found\":true,\"questions\":[{\"stem\":\"题干\"}]}。每道题干不超过 180 字。",
          `页面标题：${clip(page.title ?? row.title, 120)}`,
          content,
        ].join("\n"),
        500,
      )
      const questions = questionsFromModel(raw)
      if (questions.length === 0) continue
      send(response, 200, {
        line: "这是从公开页面上抽到的题干，不是我编的。点开出处核对。选项和答案如果页面上没有，我就不补。",
        source: { title: clip(page.title ?? row.title, 120) || "来源页面", url },
        questions,
      })
      return
    }
    send(response, 200, {
      line: "这次搜到的页面里没有能核对的题干。可以换一个说法，或把自己找到的卷子拍给我。",
      source: null,
      questions: [],
    })
  } catch {
    send(response, 502, { error: "真题页面暂时没有抓到" })
  }
}

async function completeVision(apiKey: string, prompt: string, image: string): Promise<string> {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-flash",
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image, detail: "high" } },
          ],
        },
      ],
    }),
  })
  if (!response.ok) throw new Error(`vision ${response.status}`)
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const line = payload.choices?.[0]?.message?.content?.trim()
  if (!line) throw new Error("empty")
  return line.slice(0, 1200)
}

async function postJson(apiKey: string, url: string, body: unknown): Promise<SeniorBody> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`tool ${response.status}`)
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {}
  return payload as SeniorBody
}

async function complete(apiKey: string, prompt: string, maxTokens = 220): Promise<string> {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.4,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
  })
  if (!response.ok) throw new Error(`deepseek ${response.status}`)
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const line = payload.choices?.[0]?.message?.content?.trim()
  if (!line) throw new Error("empty")
  return line.slice(0, 2000)
}

function scoreSource(result: unknown): number {
  if (!result || typeof result !== "object") return 9
  const url = String((result as SeniorBody).url ?? "").toLowerCase()
  if (url.endsWith(".pdf") || url.includes(".pdf") || url.includes("drive.google.com") || url.includes(".docx")) return 5
  return 0
}

function clip(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}

/** The daily line is the page headline: keep one sentence, short enough to sit in two lines. */
function tighten(line: string): string {
  const first = line.split(/[。！？\n]/)[0]?.trim() ?? line
  if (first.length <= 46) return `${first.replace(/[，,：:；;]$/, "")}。`
  const head = first.slice(0, 46)
  const cut = Math.max(head.lastIndexOf("，"), head.lastIndexOf("："), head.lastIndexOf("；"))
  const kept = cut >= 22 ? head.slice(0, cut) : head
  return `${kept.replace(/[，,：:；;]$/, "")}。`
}

function send(response: JsonResponse, status: number, body: unknown) {
  response.statusCode = status
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.end(JSON.stringify(body))
}

function readJson(request: IncomingMessage | Request, limit = 20_000): Promise<SeniorBody> {
  if (request instanceof Request) return readLimitedBody(request, limit).then((result) => {
    if (!result.ok) throw new Error("too large")
    const body: unknown = JSON.parse(new TextDecoder().decode(result.bytes))
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid body")
    return body as SeniorBody
  })
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error("too large"))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString() || "{}")
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("invalid"))
          return
        }
        resolve(parsed as SeniorBody)
      } catch (error) {
        reject(error)
      }
    })
    request.on("error", reject)
  })
}
