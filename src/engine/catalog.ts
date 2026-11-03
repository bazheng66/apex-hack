import type { ExamDef, ExamId, LevelDef, LevelId, Question } from "./types.ts"

export const LEVELS: LevelDef[] = [
  {
    id: "start",
    name: "刚开始",
    detail: "题还看不太懂，需要有人把范围收小。",
    voice: "你说题还看不太懂。",
  },
  {
    id: "basic",
    name: "基础能做",
    detail: "单点的题能下手，综合起来容易散。",
    voice: "你说基础题能做。",
  },
  {
    id: "uneven",
    name: "有的章节会崩",
    detail: "有的地方已经稳，有的地方一综合就错。",
    voice: "你说有的章节会崩。",
  },
  {
    id: "polish",
    name: "在冲高分",
    detail: "大部分能拿分，剩下的是反复错的点。",
    voice: "你说剩下的是易错点。",
  },
]

export const EXAMS: ExamDef[] = [
  {
    id: "os",
    name: "操作系统",
    topics: [
      {
        id: "os-sync",
        name: "同步与互斥",
        drill: "拿一道生产者消费者，只写每个等待和每个唤醒。不确定的箭头空着，先不要对笔记。",
        minimum: "只写消费者的第一句等待。写完就停。",
      },
      {
        id: "os-paging",
        name: "页面置换",
        drill: "用同一条访问串，把 FIFO 和 LRU 各跑一遍。只标出第一次淘汰不一样的那一页。",
        minimum: "只跑到第一次需要淘汰的那一步，两种算法各写一个页号。",
      },
      {
        id: "os-deadlock",
        name: "死锁与银行家",
        drill: "拿上次那张银行家算法表，把 Available、Need、Allocation 三列对齐。先不要写安全序列。",
        minimum: "只补你空着的那一列，填完就停。",
      },
      {
        id: "os-schedule",
        name: "处理机调度",
        drill: "用同一组进程，只算时间片轮转的前两个时间点。上下文切换先算进去。",
        minimum: "只写第一个时间片结束时，谁在运行。",
      },
    ],
  },
  {
    id: "network",
    name: "计算机网络",
    topics: [
      {
        id: "net-reliable",
        name: "可靠传输",
        drill: "画一个停等的时间线：发出、等待、确认。标出信道上空着的那段。",
        minimum: "只标出发出到确认回来之前，信道在等什么。",
      },
      {
        id: "net-congestion",
        name: "拥塞控制",
        drill: "把慢开始和拥塞避免分开写：每来一个 ACK，窗口各怎么变。不要混在一句里。",
        minimum: "只写拥塞避免阶段，一个 RTT 里窗口大约加多少。",
      },
      {
        id: "net-routing",
        name: "路由",
        drill: "用三台路由器写一个距离向量的更新。某条链路断开后，只写下一轮各自的距离。",
        minimum: "只写断开后的第一轮，谁会把距离加一。",
      },
      {
        id: "net-dns",
        name: "应用层解析",
        drill: "从主机发出一次解析，写下主机、本地解析器、根之间谁对谁负责。",
        minimum: "只写主机自己要不要继续追问下一台服务器。",
      },
    ],
  },
  {
    id: "ds",
    name: "数据结构",
    topics: [
      {
        id: "ds-tree",
        name: "树",
        drill: "插入一个结点后，从插入点往根找第一处平衡因子变成 ±2 的祖先。先不要做旋转。",
        minimum: "只标出最小不平衡子树的根。",
      },
      {
        id: "ds-graph",
        name: "图",
        drill: "给一张无向连通图，先数顶点和最小生成树的边。权值先不要排。",
        minimum: "只写 n 个顶点的最小生成树有几条边。",
      },
      {
        id: "ds-sort",
        name: "排序",
        drill: "拿一组已经接近有序的数，写快速排序第一次划分。看基准落在哪。",
        minimum: "只判断这一次划分是均衡还是贴边。",
      },
      {
        id: "ds-hash",
        name: "查找与散列",
        drill: "用开放寻址写一次查找。删掉一个元素后，标明这个位置不能当成没来过。",
        minimum: "只写删除后这个格子该留下什么标记。",
      },
    ],
  },
]

export const QUESTIONS: Question[] = [
  {
    id: "os-1",
    examId: "os",
    topicId: "os-sync",
    prompt: "缓冲区为空时，消费者先执行 P(mutex)，再执行 P(empty)。接下来更准确的后果是？",
    choices: [
      "只是并发变低，不会互相卡住",
      "消费者占着互斥锁等待空缓冲，生产者无法进入",
      "把 empty 的初值改成 0 就能避免",
      "去掉 mutex，只留 empty 和 full 即可",
    ],
    answer: 1,
    notes: [
      "这不只是变慢。空缓冲上先拿互斥锁再等待，生产者进不了临界区。",
      "对。锁还在消费者手里，生产者被挡在门外。",
      "empty 的初值是空位数量，改成 0 解决不了持锁等待。",
      "去掉互斥之后，临界区本身就不再被守住。",
    ],
  },
  {
    id: "os-2",
    examId: "os",
    topicId: "os-paging",
    prompt: "三个页框，访问串 1，2，3，2，1，4。第一次淘汰时，FIFO 和 LRU 淘汰的页分别是？",
    choices: ["都是 1", "FIFO 淘汰 1，LRU 淘汰 3", "FIFO 淘汰 3，LRU 淘汰 1", "都是 3"],
    answer: 1,
    notes: [
      "两次淘汰并不相同。4 到来前，1 被再次使用过，LRU 不会先丢掉它。",
      "对。FIFO 按进入顺序丢掉 1；LRU 丢掉最久没被碰的 3。",
      "方向反了。FIFO 先丢掉最早进来的 1，不是 3。",
      "只有 LRU 在这一步丢掉 3。FIFO 丢掉的是 1。",
    ],
  },
  {
    id: "os-3",
    examId: "os",
    topicId: "os-deadlock",
    prompt: "银行家算法判断当前是否安全时，只看 Need、不看 Allocation，缺了什么？",
    choices: [
      "什么都不缺，Need 已经包含全部信息",
      "缺进程结束时会交还的资源，安全推进算不下去",
      "只影响快慢，不影响安全结论",
      "安全序列只由 Max 决定，两列都可以不看",
    ],
    answer: 1,
    notes: [
      "Need 只说明还要多少，不说明手里正占着多少。进程完成后交还的是 Allocation。",
      "对。安全算法要把完成进程占着的资源加回可用量，没有 Allocation 就加不回去。",
      "缺了交还量，序列会在中途断掉，这是结论问题，不是快慢问题。",
      "Max 也代替不了当前占用量。推进时加回去的是 Allocation。",
    ],
  },
  {
    id: "os-4",
    examId: "os",
    topicId: "os-schedule",
    prompt: "时间片轮转里，把时间片切得极短，主要代价是？",
    choices: [
      "响应一定变差，因为切换太频繁",
      "响应更快，但上下文切换的开销变大",
      "切换在内核里，所以没有额外开销",
      "效果等价于先来先服务",
    ],
    answer: 1,
    notes: [
      "时间片变短，新进程更快轮到，响应通常更好，不是更差。代价在切换。",
      "对。响应改善，切换次数上去，开销变成主要代价。",
      "切换要保存和恢复现场，次数多了就不是免费的。",
      "先来先服务要等前面的进程走完，和时间片极短不是一回事。",
    ],
  },
  {
    id: "net-1",
    examId: "network",
    topicId: "net-reliable",
    prompt: "停等协议的信道利用率往往很低，主要原因是？",
    choices: [
      "发出一个分组后，大部分时间在等确认",
      "序号只有 0 和 1，所以传不远",
      "校验和计算比传播更慢",
      "接收窗口必须保持为 0",
    ],
    answer: 0,
    notes: [
      "对。一个往返里真正在传数据的只有一小段，其余在等确认。",
      "序号短会影响流水线怎么编号，不是停等利用率低的主因。",
      "停等的空等来自往返时间，不是校验和算得慢。",
      "停等可以理解为发送窗口是 1，不是要求接收窗口为 0。",
    ],
  },
  {
    id: "net-2",
    examId: "network",
    topicId: "net-congestion",
    prompt: "进入拥塞避免之后，拥塞窗口更准确的变化是？",
    choices: [
      "每收到一个 ACK，窗口加一个 MSS",
      "大约每个 RTT 增加一个 MSS",
      "每收到一个 ACK，窗口减半",
      "窗口保持不动，直到超时",
    ],
    answer: 1,
    notes: [
      "每个 ACK 加一个 MSS，是慢开始，不是拥塞避免。",
      "对。拥塞避免把一个 MSS 的增长摊到大约一个往返上。",
      "减半发生在丢包或超时的处理里，不是每来一个 ACK 都减。",
      "窗口仍在涨，只是涨得慢。超时前不会停住。",
    ],
  },
  {
    id: "net-3",
    examId: "network",
    topicId: "net-routing",
    prompt: "距离向量路由里，计数到无穷主要是在说？",
    choices: [
      "一条路由失效后，邻居把距离一跳一跳加到上限",
      "每台路由器都要把整张图洪泛出去",
      "Dijkstra 在负权边上不会停",
      "分组的 TTL 必须设成无限",
    ],
    answer: 0,
    notes: [
      "对。坏消息传得慢，距离会一轮轮增加，直到数到约定的无穷。",
      "洪泛整张图是链路状态的做法，不是距离向量的计数到无穷。",
      "距离向量不用 Dijkstra。计数到无穷来自互相引用过期的距离。",
      "这是路由表里的距离在涨，不是分组的 TTL 设成无限。",
    ],
  },
  {
    id: "net-4",
    examId: "network",
    topicId: "net-dns",
    prompt: "主机把域名交给本地递归解析器之后，主机自己通常还要做什么？",
    choices: [
      "按每个 NS 记录继续问下一台服务器",
      "等待解析器返回最终结果，逐级查询由解析器完成",
      "改用迭代，因为递归不能返回地址",
      "直接从根服务器开始自己问",
    ],
    answer: 1,
    notes: [
      "那是迭代查询里客户端或解析器自己要走的路。交给递归解析器之后，主机不再逐台问。",
      "对。主机等最终结果。根、顶级域、权威服务器之间的往返由解析器承担。",
      "递归查询就可以返回最终地址。不是必须改成迭代。",
      "直接问根，是没有把这件事交给递归解析器。",
    ],
  },
  {
    id: "ds-1",
    examId: "ds",
    topicId: "ds-tree",
    prompt: "平衡二叉树插入后失衡，最小不平衡子树的根是？",
    choices: [
      "离插入点最近、平衡因子变成 ±2 的祖先",
      "整棵树的根",
      "新插入的那个叶子",
      "深度最大的结点的父节点",
    ],
    answer: 0,
    notes: [
      "对。从插入点向上，第一处平衡因子变成 ±2 的结点，就是最小不平衡子树的根。",
      "整棵树的根只有在它自己也变成 ±2 时才是。一般更近。",
      "叶子是插入点，不是失衡子树的根。",
      "深度最大不能代替平衡因子。要看 ±2 出现在哪。",
    ],
  },
  {
    id: "ds-2",
    examId: "ds",
    topicId: "ds-graph",
    prompt: "无向连通图有 n 个顶点。它的最小生成树有几条边？",
    choices: ["n", "n − 1", "n(n − 1) / 2", "由边权决定，没有固定条数"],
    answer: 1,
    notes: [
      "n 条边会成环，不再是树。",
      "对。连通并且无环，n 个顶点就是 n − 1 条边。权值决定选哪几条，不决定条数。",
      "那是完全图的边数，不是生成树的边数。",
      "权值改变选边，不改变生成树的边数。",
    ],
  },
  {
    id: "ds-3",
    examId: "ds",
    topicId: "ds-sort",
    prompt: "快速排序的平均时间和最坏时间，哪一种说法站得住？",
    choices: [
      "平均 O(n log n)，最坏 O(n²)，最坏来自划分极度倾斜",
      "平均和最坏都是 O(n log n)",
      "平均 O(n²)，最坏 O(n log n)",
      "最坏只和数据规模有关，和划分无关",
    ],
    answer: 0,
    notes: [
      "对。划分一直贴边时，递归深度变成 n，最坏到 O(n²)。",
      "最坏不是 O(n log n)。已经有序且基准总取到端点时就会倾斜。",
      "平均和最坏说反了。",
      "同样的规模，划分均衡或贴边，时间差一个量级。",
    ],
  },
  {
    id: "ds-4",
    examId: "ds",
    topicId: "ds-hash",
    prompt: "开放寻址的哈希表里，删除一个元素时不能直接置空。原因是？",
    choices: [
      "空位会截断探测链，后面的元素可能被当成不存在",
      "装填因子会变成负数",
      "开放寻址一旦插入就不能删除",
      "只是浪费空间，查找结果不变",
    ],
    answer: 0,
    notes: [
      "对。查找沿探测链走，遇到空位就停。中间被挖空，后面的键会丢。",
      "删掉一个元素，装填因子下降，不会变成负数。",
      "可以删除，但格子要留下“曾被占用”的标记，而不是真的空。",
      "查找结果会变。探测会在空位提前停住。",
    ],
  },
]

const LEVEL_SCORES: Record<LevelId, number[]> = {
  start: [32, 30, 28, 26],
  basic: [56, 50, 42, 36],
  uneven: [74, 40, 58, 66],
  polish: [80, 78, 74, 60],
}

export function examById(id: ExamId): ExamDef {
  const found = EXAMS.find((exam) => exam.id === id)
  if (!found) throw new Error(`unknown exam: ${id}`)
  return found
}

export function levelById(id: LevelId): LevelDef {
  const found = LEVELS.find((level) => level.id === id)
  if (!found) throw new Error(`unknown level: ${id}`)
  return found
}

export function topicById(examId: ExamId, topicId: string) {
  const topic = examById(examId).topics.find((item) => item.id === topicId)
  if (!topic) throw new Error(`unknown topic: ${topicId}`)
  return topic
}

export function questionById(id: string): Question {
  const found = QUESTIONS.find((question) => question.id === id)
  if (!found) throw new Error(`unknown question: ${id}`)
  return found
}

export function scoresForLevel(level: LevelId): readonly number[] {
  return LEVEL_SCORES[level]
}

export function initialMastery(examId: ExamId, level: LevelId) {
  const exam = examById(examId)
  const scores = scoresForLevel(level)
  return exam.topics.map((topic, index) => ({
    topicId: topic.id,
    score: scores[index] ?? scores[scores.length - 1] ?? 40,
  }))
}
