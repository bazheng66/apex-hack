# Testpass 发布交接（2026-11-03 更新）

已完成的发布步骤：

- PR #6 已 squash 合并（`dcaff05`）；`codex/record-cloud-imports` 已 `rebase --onto origin/main 86b2556` 后推送，PR #7（`e0902f2`）合并进 `main`，默认分支现在包含同步、导入、项目介绍与 LICENSE。
- Vercel 项目 `bazheng66/testpass-ai` 已创建并发布到 Production；Framework 识别为 Vite，构建 `npm run build`，输出 `dist`。
- 环境变量：`VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`（Production/Preview/Development），`DEEPSEEK_API_KEY`（Production，sensitive）。
- Deployment Protection 已关闭（此前默认 `all_except_custom_domains`，访客会被要求登录 Vercel）。
- `supabase/migrations/20261103130000_record_sync.sql` 已在远端项目应用。用匿名 JWT 实测：`save_record_state` 返回新 revision，重放旧 revision 返回 `PT409`。
- 自定义域名 `testpass.b1z.xyz` 已加入项目（`verified: true`），等待域名实名审核通过并添加 CNAME `cname.vercel-dns.com`。

## 剩余发布顺序

1. 域名 `b1z.xyz` 在阿里云完成注册局实名审核后，添加 CNAME：主机记录 `testpass` → `cname.vercel-dns.com`，TTL 10 分钟。
2. 域名生效后做生产验收（见下方「验证」第 4 条），通过即作为提交用的体验链接。
3. 作品信息冻结时间为 2026-11-05 12:00（Asia/Shanghai）。

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
