# Testpass 个性化 AI 考试通过助手

一个按考试督促你的陪练。第一次进入时选择要应对的考试和当前水平。之后它按最弱的一块安排每天的专项，收你在站内做的题，也收你自己找来做完的结果，并把实力变化记下来。

完整题库以后可以收费。这一版每个考试只开放四道题，用来把错法和分数记实。

作品定位、功能、算法规则、技术架构与已知边界见 [作品介绍](docs/PROJECT.md)。

- 前端：React 19 · Vite 8 · TypeScript · Tailwind 4 · React Router 7
- 数据：Supabase（匿名登录 + RLS + 事务化记录同步）
- 服务端：Vercel Functions（DeepSeek 评语/识图/检索、题库导入 API v1）
- 测试：160 个用例通过，含 PGlite 真实 PostgreSQL 迁移、RLS 跨用户隔离、版本冲突

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开 http://127.0.0.1:4731 。默认不用注册。配置 Supabase 后使用匿名会话同步记录；未配置时保存在本机。想换设备继续，可以在「账号」页把进度绑到邮箱上，之后用同一邮箱收登录链接即可恢复。

Testpass 的评语、识图和真题检索走 DeepSeek。把 `.env.example` 复制成 `.env`，填入 `DEEPSEEK_API_KEY`，再启动。密钥只在本地服务里使用，不要加 `VITE_` 前缀，也不要提交 `.env`。接口不可用时，页面仍显示按规则写成的话，分数不受影响。

对话页可以发文字、上传卷面照片，或按当前专项搜索公开页面。真题只抽取抓到的页面里实际出现的题干，并给出出处链接，不补写页面上没有的选项和答案。

```bash
npm test
npm run lint
npm run build
```

## Supabase

数据库迁移在 `supabase/migrations/`。访客演示在 Dashboard 打开 Anonymous，客户端 `signInAnonymously()`，行级权限按 `auth.uid()` 隔离。项目地址：https://bhylflnzkwmhhaskduqp.supabase.co

## 题库导入 API v1

`POST /api/v1/imports` 支持公开链接、粘贴 HTML/纯文本、JSON/CSV/Markdown 上传。服务端抓取不带 Cookie、Authorization，也不代登。私网、链路本地和云元数据地址会拒绝。登录墙把任务记为 `rejected`，错误码 `LOGIN_WALL`，界面引导用户粘贴或上传。Python Scrapling 不能在这个 Node/Vercel 函数里跑，所以用 Node 适配器抽题。

导入不写 `attempts`。扩展包仍返回 501。应用体积上限：HTML 2MB，JSON/CSV/Markdown 5MB；部署平台可能有更低的请求上限，当前界面上传限 1.5MB。

本地对着 Supabase 试见 `docs/api-v1-imports.md`。`npm run dev` 和 Vercel 走同一套处理函数。

同步协议、迁移步骤与发布检查见 [部署交接](docs/deployment.md)。新客户端上线前必须应用 `20261103130000_record_sync.sql`。考试快照保留旧版未记录原始答案的数据；新答题事件只追加到 `attempts`，重复发送按稳定事件 ID 去重。

## 给评审的一条路径

1. 首页可以直接点「先看一份练过几天的记录」。这是操作系统、有的章节会崩、页面置换已经掉过一次。
2. 今日专项应落在页面置换。点「今天做不动」，时长收到 12 分钟；再点一次，今天停止加任务。
3. 右上角「重新设定」，自己选一场考试和水平，看今天的专项是否落到最低的一块。
4. 打开「模拟」，做开放题并交卷。错了会在交卷后说明，分数跟着改。
5. 「交我做过的」填对题数和错法。如果另一块变成最低，今天的专项会改过去。
6. 「实力」里能看到开始时的刻度和后来的升降。

## 规则

| 编号 | 做什么 |
| --- | --- |
| `LOWEST_TOPIC` | 今天只安排当前分数最低的知识点，25 分钟 |
| `SKIP_TRIM` | 有一天没做，下一次收到 18 分钟，仍是同一块 |
| `SKIP_SHRINK` | 当天说做不动，收到 12 分钟；再说一次，今天不再加任务 |

站内做对 +8，做错 −4。自己交来的卷子按正确率相对 60% 增减，最高 96，最低 8。同一份记录再交一次，增减相同。

## 许可

MIT，见 [LICENSE](LICENSE)。
