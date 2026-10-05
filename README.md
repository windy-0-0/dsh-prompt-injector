# dsh-prompt-injector

在 DSH 的**设置**里新增一页「提示词注入」，把**每一次对话开始前会被自动拼进请求的全部内容**完整列出来 —— 可展开看原文、可复制。

解决什么问题：你在对话时经常看到这些字眼，但不知道它们是什么、在哪里、有多大：

```
上下文注入  memgas
上下文注入  ~/.dsh/AGENTS.md
上下文注入  @deepseek-ai/dsh-system-prompt
上下文注入  skill-catalog
```

本插件把它们**一次列清**（取自官方 `ctx.systemPrompt.assemble()` 的真实组装结果，不是文档描述）。

## 它显示什么

| 分区 | 内容 | 本机实测 |
|---|---|---|
| ① 系统提示词分段 (sections) | 内核身份、来源、应用层、部署人设、安全策略、各插件策略 | **8 段 · 4,813 字符** |
| ② 运行时上下文 (contexts) | 每轮变化的部分（注入器上下文、沙箱/审批策略等） | **3 段 · 362 字符** |
| ③ 工具说明 (tools) | 工具名 + 描述 + 参数 schema（**全部会进前缀**） | **71 段 · 33,461 字符** |
| ④ 提示词变量 (variables) | provider / model / cwd 等 | **3 个** |
| ⑤ 工作区规则文件 | `~/.dsh/AGENTS.md`（每轮注入）、`AGENTS-DETAILS.md`（按需读取） | **3,238 + 10,442 字符** |

顶部给出总览与合计：本机实测 **约 38,636 字符 ≈ 12,074 tokens**（每一轮请求都带这么多）。

每一段都标注**来源**（DSH 内核 / 应用层 / 部署人设 / 安全策略 / memgas / 工具说明 / 界面层 …），
展开后可**复制全文**。

## 安装

```bash
# 方式一：npm
dsh plugin --profile web add dsh-prompt-injector

# 方式二：GitHub
dsh plugin --profile web add github:windy-0-0/dsh-prompt-injector
```

装完**重启** `dsh web`（bundle 型插件的客户端模块在进程启动时组装一次），
然后在 **设置 → 提示词注入** 查看。

## 它与 dsh-prompt-peek 的区别

| | dsh-prompt-injector（本插件） | dsh-prompt-peek |
|---|---|---|
| 位置 | **设置 → 提示词注入** | 对话页顶部「提示词」标签 |
| 侧重 | **全局注入清单 + 每段完整原文 + 来源标注 + 字符/token 统计** | 每轮实际请求的分段 + 翻译解释 + AGENTS.md 在线编辑 |
| 是否调模型 | 不调（纯只读，零成本） | 可点「翻译并解释」（按需调模型） |

两者互补，可同时安装。

## 设计约束

- **只读**：不注册 section / context / tool / variable，不修改任何提示词，无副作用；
- **不占上下文**：插件自己不向会话添加任何提示词、工具或消息（遵守 DSH 铁律 R61 前缀稳定）；
- **不缓存 live 对象**：每次请求现场 `assemble()`，只把字符串返回给客户端。

## 实现要点（给做 DSH 客户端插件的人）

两处容易踩的坑，本插件都踩过并已修正：

1. **客户端 bundle 必须用 `format: 'cjs'`**。DSH loader 读的是 `module.exports.apply`；
   用 esbuild 的 `iife` 时 ESM 导出**不会**写进 `module.exports`，症状是设置里看不到页面并报
   `invalid plugin, expect function or object with an "apply" method, received object`。
2. **`inject` 必须声明用到的所有服务**。宿主半区用到 `webServer` 时，只写 `inject = ['systemPrompt']`
   会直接报 `cannot get property "webServer" without inject`。

此外插件会写一个自证标记 `window.__dshPromptInjectorApplied`（与 `__dshPeakGate` 等同一惯例），
让"apply 到底有没有执行"可见 —— 排查客户端插件时非常有用。

## 许可

MIT
