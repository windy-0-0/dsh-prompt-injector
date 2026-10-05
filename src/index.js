/**
 * dsh-prompt-injector · 宿主半区
 *
 * 作用：把「每一轮对话开始前会被自动注入的提示词」完整、可读地暴露出来。
 *
 * 用户问题（2026-10-05）：「每次对话都会注入很多提示词 —— memgas、~/.dsh/AGENTS.md、
 * @deepseek-ai/dsh-system-prompt、skill-catalog，但我不清楚他们都是什么、在哪里看。」
 *
 * 官方恰好有一个权威接口：`ctx.systemPrompt.assemble()` 返回本轮组装的**全部**输入：
 *   { sections, contexts, tools, variables }
 * 本插件把它原样取出来（只读），并额外标注每段的**来源插件**，供设置页展示。
 *
 * 设计约束：
 *   - 只读：不注册 section/context/tool/variable，不产生任何副作用；不改动任何提示词；
 *   - 不缓存 live 对象：每次请求现场 assemble，只把**字符串**返回给客户端；
 *   - 不占上下文：本插件不向会话添加提示词、工具或消息（R61 前缀稳定）。
 */

export const name = 'prompt-injector'
/** systemPrompt（拿组装结果）与 webServer（注册 API 路由）都是硬依赖；其余走可选获取。 */
export const inject = ['systemPrompt', 'webServer']

const PREFIX = '/prompt-injector'

function json(res, payload, status = 200) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** 按名字前缀推断来源插件，让用户知道「这段是谁塞进来的」。 */
function originOf(name) {
  if (!name) return '未知'
  if (name.startsWith('harness:')) return 'DSH 内核（harness）'
  if (name.startsWith('app:')) return 'DSH 应用层（app）'
  if (name.startsWith('deployment:')) return '部署人设（deployment）'
  if (name.startsWith('safety:')) return '安全策略插件'
  if (name.startsWith('sandbox:')) return '沙箱策略插件'
  if (name.startsWith('approval:')) return '审批策略插件'
  if (name.startsWith('tool:')) return '工具说明（tool）'
  if (name.startsWith('ui:')) return '界面层（ui）'
  if (name.startsWith('memory') || name.includes('memgas')) return 'memgas 记忆系统'
  if (name.includes('instruction') || name.includes('agents')) return 'AGENTS.md 工作区规则'
  if (name.includes('skill')) return 'skill-catalog 技能目录'
  if (name.includes('context')) return '运行时上下文'
  return '其它/第三方插件'
}

/** 取当前会话的 scope（agent 或 session）——assemble 需要它才能拿到按会话装配的结果。 */
function scopeOf(ctx, sessionId) {
  try {
    const agents = ctx.get('agents')
    if (agents && sessionId) {
      const a = agents.get(sessionId)
      if (a) return a
    }
    const sessions = ctx.get('sessions')
    if (sessions && sessionId) {
      const s = sessions.get(sessionId)
      if (s) return s
    }
  } catch { /* 拿不到就退化为全局 scope */ }
  return undefined
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname.slice(PREFIX.length) || '/'

      // ── 完整注入清单（核心）─────────────────────────────────────────
      if (req.method === 'GET' && path === '/api/dump') {
        const sessionId = url.searchParams.get('sessionId') || undefined
        try {
          const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(ctx, sessionId) })
          const sections = (assembly.sections ?? []).map((s) => ({
            name: s.name,
            origin: originOf(s.name),
            chars: (s.text ?? '').length,
            text: s.text ?? '',
          }))
          const contexts = (assembly.contexts ?? []).map((c) => ({
            name: c.name,
            origin: originOf(c.name),
            chars: (c.text ?? '').length,
            text: c.text ?? '',
          }))
          const tools = (assembly.tools ?? []).map((t) => ({
            name: t.name,
            chars: (t.description ?? '').length + JSON.stringify(t.parameters ?? {}).length,
            text: `# ${t.name}\n\n${t.description ?? ''}\n\n参数 schema:\n${JSON.stringify(t.parameters ?? {}, null, 2)}`,
          }))
          const vars = Object.entries(assembly.variables ?? {}).map(([k, v]) => ({
            name: k,
            chars: (v ?? '').length,
            text: v ?? '',
          }))

          // 去掉空段（有的是空字符串占位），但保留计数以便用户知道"存在但为空"
          const total = { sections: sections.length, contexts: contexts.length, tools: tools.length, variables: vars.length }
          const chars = {
            sections: sections.reduce((n, x) => n + x.chars, 0),
            contexts: contexts.reduce((n, x) => n + x.chars, 0),
            tools: tools.reduce((n, x) => n + x.chars, 0),
            variables: vars.reduce((n, x) => n + x.chars, 0),
          }
          return json(res, {
            ok: true,
            at: new Date().toISOString(),
            sessionId: sessionId ?? null,
            total, chars,
            grandChars: chars.sections + chars.contexts + chars.tools + chars.variables,
            sections, contexts, tools, variables: vars,
          })
        } catch (e) {
          return json(res, { ok: false, error: String(e && e.message ? e.message : e) }, 500)
        }
      }

      // ── 工作区规则文件（AGENTS.md 一族）原文 ────────────────────────
      if (req.method === 'GET' && path === '/api/agents') {
        const { readFileSync, existsSync } = await import('node:fs')
        const { join } = await import('node:path')
        const { homedir } = await import('node:os')
        const home = process.env.DSH_HOME || join(homedir(), '.dsh')
        const files = [
          { path: join(home, 'AGENTS.md'), label: 'AGENTS.md（精简版，每轮注入）' },
          { path: join(home, 'AGENTS-DETAILS.md'), label: 'AGENTS-DETAILS.md（全文版，按需读取）' },
        ]
        const out = files.map((f) => {
          if (!existsSync(f.path)) return { ...f, exists: false, chars: 0, text: '' }
          try {
            const t = readFileSync(f.path, 'utf8')
            return { ...f, exists: true, chars: t.length, text: t }
          } catch (e) {
            return { ...f, exists: false, chars: 0, text: '', error: String(e) }
          }
        })
        return json(res, { ok: true, files: out })
      }

      // ── 健康检查 ───────────────────────────────────────────────────
      if (req.method === 'GET' && path === '/api/health') {
        return json(res, { ok: true, service: 'prompt-injector' })
      }

      return json(res, { ok: false, error: 'not found' }, 404)
    },
  }), 'prompt-injector: prompt dump API')
}
