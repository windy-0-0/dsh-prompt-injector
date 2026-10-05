# dsh-prompt-injector

在 DSH 的**设置**里新增一页「提示词注入」：

1. **看清楚**：每一次对话开始前会被自动拼进请求的**全部内容**，一次列清（可展开看原文、可复制）；
2. **管得住**：每一段都有**开关** —— 关掉的段**真的不会进请求**，省下的是真实 token。

解决什么问题：你在对话时经常看到这些字眼，但不知道它们是什么、在哪里、有多大：

```
上下文注入  memgas
上下文注入  ~/.dsh/AGENTS.md
上下文注入  @deepseek-ai/dsh-system-prompt
上下文注入  skill-catalog
```

本插件把它们的**真实组装结果**（官方 `ctx.systemPrompt.assemble()`，非文档描述）列全，
并允许你逐段控制是否注入。

## 它显示什么（本机实测）

| 分区 | 内容 | 实测 |
|---|---|---|
| ① 系统提示词分段 (sections) | 内核身份/来源、应用层、部署人设、安全策略、任务看板、模型路由… | **8 段 · 4,813 字符** |
| ② 运行时上下文 (contexts) | 每轮变化的部分（注入器上下文、沙箱/审批策略） | **3 段 · 362 字符** |
| ③ 工具说明 (tools) | 工具名 + 描述 + 参数 schema | **71 段 · 33,461 字符** |
| ④ 提示词变量 (variables) | provider / model / cwd | **3 个** |
| ⑤ 工作区规则文件 | `~/.dsh/AGENTS.md`（每轮注入）+ `AGENTS-DETAILS.md`（按需读取） | **3,238 + 10,442 字符** |

**合计约 38,636 字符 ≈ 12,074 tokens —— 每一轮请求都带着这么多。**

顺带一个有用的事实：**工具说明占 33,461 字符，是总量的 87%**。想瘦身，先看工具表。

## 开关是真拦截，不是隐藏

关掉的段通过官方 **`system-prompt/assemble` 瀑布**在组装阶段就删掉：

```
Dsh 组装提示词 → emit system-prompt/assemble（assembly 可变，返回值即权威）
                              ↓
             本插件按名字删除被禁用的 sections / contexts / tools / variables
                              ↓
                     模型真的收不到这些内容
```

实测证据（往返验证）：

| 操作 | 启用字符数 |
|---|---|
| 全部启用 | 38,636 |
| 禁用 `harness:source`（358）+ `defend_report`（188） | **38,090**（正好少 546） |
| 恢复 `harness:source` | 38,448 |
| 再禁用 | 38,090 |

被禁用的段**仍留在列表里**（划掉 + 变暗 + 复选框未勾），随时可以恢复 —— 开关可逆。
状态持久化到 `<DSH_HOME>/prompt-injector/config.json`（原子写），改动**下一轮请求即生效**。

## 界面

- 顶部总览：每类 `已启用 / 全部` 字符数，以及「已关闭 N 字符（≈M tokens/轮）」
- 每个分区：段数、启用/禁用计数、字符统计、**「全部启用」**一键恢复
- 工具区（71 段）带**名字过滤**与**「禁用的排前面」**，便于批量收敛
- 每段可展开看**完整原文**并**复制全文**

## 安装

```bash
dsh plugin --profile web add github:windy-0-0/dsh-prompt-injector
```

装完**重启** `dsh web`（bundle 型插件的客户端模块在进程启动时组装一次），
然后在 **设置 → 提示词注入** 查看。

> ⚠️ **谨慎关闭的段**：`safety:policy`、`sandbox:policy`、`approval:policy` 是安全策略；
> `harness:identity` / `harness:source` 是内核自我说明；工具说明关掉后模型可能不会正确使用该工具。
> 默认**全部启用**——不装不改你的环境。

## 与 dsh-prompt-peek 的区别

| | dsh-prompt-injector（本插件） | dsh-prompt-peek |
|---|---|---|
| 位置 | **设置 → 提示词注入** | 对话页顶部「提示词」标签 |
| 侧重 | 全局清单 + **逐段开关** + 字符/token 统计 | 每轮实际请求 + 翻译解释 + AGENTS.md 在线编辑 |
| 是否调模型 | 不调（只读 + 过滤，零成本） | 可点「翻译并解释」（按需调模型） |

两者互补，可同时安装。

## 实现要点（给做 DSH 客户端插件的人）

三处坑，本插件都踩过并已修正：

1. **客户端 bundle 必须 `format: 'cjs'`**。DSH loader 读 `module.exports.apply`；
   用 esbuild 的 `iife` 时 ESM 导出**不会**写进 `module.exports`，症状是设置里看不到页面并报
   `invalid plugin, expect function or object with an "apply" method, received object`。
2. **`inject` 必须声明用到的所有服务**：用 `webServer` 时只写 `['systemPrompt']` 会报
   `cannot get property "webServer" without inject`。
3. **"已过滤"与"完整视图"要分开**：`assemble()` 的返回值已经被自己的瀑布过滤过，
   若直接拿来做界面，用户**禁掉一段后就再也看不到它、无法恢复**（开关变成不可逆）。
   本插件用一个 `bypassDepth` 计数器在 dump 期间旁路自己的过滤，取完整清单再单独标注启用状态。

另外插件会写自证标记 `window.__dshPromptInjectorApplied`（与 `__dshPeakGate` 等同一惯例），
让"apply 到底有没有执行"可直接观测 —— 排查客户端插件时非常有用。

## 许可

MIT
