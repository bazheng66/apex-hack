# Testpass 发布交接（2026-11-03）

本分支基于 PR #6 的 `86b2556`；#6 尚未合并。GitHub 插件合并/创建分支均返回 403，本机 git 推送连接失败。未发布到 Vercel，未修改远端数据库。

## 发布顺序

1. Squash 合并 PR #6。本分支在其后执行 `git fetch origin`，再执行 `git rebase --onto origin/main 86b2556 codex/record-cloud-imports`，避免重复引入 #6。
2. 审阅并应用 `supabase/migrations/20261103130000_record_sync.sql`。2026-11-03 的只读检查返回 `42703`，远端尚无 `record_revision` 列。可在已授权的 Supabase SQL Editor 执行这个新增迁移；不要重复执行旧的建表迁移。
3. 配置 Vercel：Framework 为 Vite，安装 `npm ci`，构建 `npm run build`，输出目录 `dist`。仓库已有 `api/v1/*` 和 AI 函数入口；`vercel.json` 包含应用路由刷新回退。
4. Preview 和 Production 均设置 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`。值取项目的 publishable 配置。客户端不接受服务端密钥。服务端导入也使用 publishable key 和调用者 JWT，经 RLS 写入。
5. 可选设置服务端 `DEEPSEEK_API_KEY`；不要使用 `VITE_` 前缀。当前 LLM 适配器仍调用官方 DeepSeek 端点。若使用兼容服务，需要先确认并配置其 API 地址与模型，不能只替换密钥。没有密钥时，界面继续使用规则评语。
6. 部署 Preview 并完成以下检查，通过后发布 Production。作品信息冻结时间为 2026-11-05 12:00（Asia/Shanghai）。比赛提交及测试 bot 尚未执行。

## 同步协议

`exams.record_state` 是 UI 恢复快照，保留旧版 mastery、复习卡、错法和历史记录；`record_revision` 是并发版本。`save_record_state` 是 SECURITY INVOKER 函数，使用调用者 JWT、RLS、考试行锁和版本比较，将快照更新与事件追加放在同一事务。版本不符返回 `PT409`，客户端重新读取后合并并重试。

`attempts` 只插入，冲突时 `DO NOTHING`，原有禁止更新/删除的触发器继续生效。事件 UUID 由用户、考试和本地 session ID 稳定生成；新操作的 session ID 使用随机 UUID。新事件保存原始选择/对错或自交题量，不从分数反推答案。旧版缺少原始答案的记录保留快照，派生层明确使用迁移快照，不伪造原始答题证据。新记录沿用 score+Elo 重放。

浏览器缓存按匿名用户隔离，失败/离线时保留未发送动作，网络恢复或点击「重试同步」后串行发送。身份变化会丢弃旧请求的 UI 回写。旧 `qianbei-record-v1` 和 `qianbei-bank-*` 只认领给首个迁移身份，保留本地原件。旧题库迁移到 sources/items；新导入直接走 JWT API，成功/进度/失败重试显示在导入窗口。

「重新设定」返回设置界面，保留云端学习历史；再选同一考试会恢复该考试并更新目标。匿名身份随浏览器数据保存，尚无跨设备恢复。遇到缺少原始输入的旧版并发冲突时停止覆盖，保留本地副本并提示处理。

## 验证

- `npm test`：包含真实 PostgreSQL（PGlite）迁移、RLS 跨用户隔离、事务回滚、版本冲突、重试去重和 attempts 不可改删测试；还覆盖离线恢复、写入期间的新操作和身份切换。
- `npm run build`：前后端 TypeScript 和生产构建。
- `npm run lint`：已有 5 个警告，涉及 review 测试、Fast Refresh 和组件 effect；没有新增 lint 错误。
- 生产环境仍需验收：创建匿名记录 → 完成专项 → 刷新恢复 → 断网操作/恢复同步 → 粘贴和文件导入/重试 → 新无痕会话不能看到旧会话记录 → `/today` 深链接刷新。
- 不要把本地 PostgreSQL 通过当作远端迁移已应用；当前 live Supabase 集成测试仍默认跳过。

Vercel 路由和函数形式参考：[Vite 部署](https://vercel.com/docs/frameworks/frontend/vite)、[Node 函数](https://vercel.com/docs/functions/runtimes/node-js)。
