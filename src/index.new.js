/**
 * dsh-prompt-injector · 宿主半区
 *
 * 作用：① 披露每一轮对话开始前会被自动注入的全部提示词（只读清单）
 *       ② 允许**逐段开关**：关掉的段真的不会进请求（走官方 `system-prompt/assemble` 瀑布）
 *
 * 拦截机制（本插件的关键，不是"展示层隐藏"）：
 *   DSH 每次组装提示词时都会走 `system-prompt/assemble` 瀑布事件，
 *   参数 `assembly` 是**可变对象**，其返回值即权威结果（见官方类型注释与 loop.spec.ts 的用法）。
 *   我们在瀑布里按名字删除被禁用的 sections / contexts / tools / variables，
 *   于是模型**真的收不到**这些内容 —— 省下的是真实 token，不是视觉隐藏。
 *
 * 设计约束：
 *   - 默认**全部启用**（不加开关即原样透传，绝不悄悄改变你的环境）；
 *   - 只按名字过滤，不改写任何段的内容；
 *   - 开关持久化到 <DSH_HOME>/prompt-injector/config.json（原子写，改动下一轮即生效）；
 *   - 不向会话注入任何提示词/工具（R61 前缀稳定）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'prompt-injector'
/** systemPrompt（组装结果 + 瀑布拦截）与 webServer（API）都是硬依赖。 */
export const inject = ['systemPrompt', 'webServer']

const PREFIX = '/prompt-injector'
const KINDS = ['sections', 'contexts', 'tools', 'variables']

function stateDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'prompt-injector')
}
function configPath() { return join(stateDir(), 'config.json') }

/** 被禁用的名字：按类别分开存，避免同名碰撞。 */
function loadConfig() {
  const empty = { sections: [], contexts: [], tools: [], variables: [] }
  const p = configPath()
  if (!existsSync(p)) return empty
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    return {
      sections: Array.isArray(raw.sections) ? raw.sections : [],
      contexts: Array.isArray(raw.contexts) ? raw.contexts : [],
      tools: Array.isArray(raw.tools) ? raw.tools : [],
      variables: Array.isArray(raw.variables) ? raw.variables : [],
    }
  } catch { return empty }
}

/** 原子写：先写临时文件再 rename，避免半截文件（settings-file 的教训）。 */
function saveConfig(cfg) {
  const p = configPath()
  mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  renameSync(tmp, p)
}

function json(res, payload, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = ''
    req.on('data', (c) => { d += c; if (d.length > 1_000_000) req.destroy() })
    req.on('end', () => resolve(d))
    req.on('error', () => resolve(''))
  })
}

/** 按名字前缀推断来源，让用户知道「这段是谁塞进来的」。 */
function originOf(name) {
  if (!name) return '未知'
  if (name.startsWith('harness:')) return 'DSH 内核（harness）'
  if (name.startsWith('app:')) return 'DSH 应用层（app）'
  if (name.startsWith('deployment:')) return '部署人设（deployment）'
  if (name.startsWith('safety:')) return '安全策略插件'
  if (name.startsWith('sandbox:')) return '沙箱策略插件'
  if (name.startsWith('approval:')) return '审批策略插件'
  if (name.startsWith('plan:')) return '计划策略插件'
  if (name.startsWith('tool:')) return '工具说明（tool）'
  if (name.startsWith('ui:')) return '界面层（ui）'
  if (name.startsWith('context:')) return '上下文（context）'
  if (name.includes('memgas') || name.startsWith('memory')) return 'memgas 记忆系统'
  if (name.includes('injector')) return 'dsh-super-injector'
  return '其它/第三方插件'
}

function scopeOf(ctx, sessionId) {
  try {
    const agents = ctx.get('agents')
    if (agents && sessionId) { const a = agents.get(sessionId); if (a) return a }
    const sessions = ctx.get('sessions')
    if (sessions && sessionId) { const s = sessions.get(sessionId); if (s) return s }
  } catch { /* 拿不到就退化为全局 scope */ }
  return undefined
}

export function apply(ctx) {
  // ── ① 瀑布拦截：在官方组装流程里删掉被禁用的段（真实生效）──────────
  ctx.effect(() => ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    try {
      const cfg = loadConfig()
      const keep = (arr, deny) => (Array.isArray(arr) && deny.length > 0)
        ? arr.filter((x) => !deny.includes(x && x.name))
        : arr
      if (assembly) {
        if (Array.isArray(assembly.sections)) assembly.sections = keep(assembly.sections, cfg.sections)
        if (Array.isArray(assembly.contexts)) assembly.contexts = keep(assembly.contexts, cfg.contexts)
        if (Array.isArray(assembly.tools)) assembly.tools = keep(assembly.tools, cfg.tools)
        if (assembly.variables && cfg.variables.length > 0) for (const k of cfg.variables) delete assembly.variables[k]
      }
    } catch { /* 过滤失败绝不能影响主流程：原样透传 */ }
    return next()
  }), 'prompt-injector: 段开关拦截')

  // ── ② HTTP API ───────────────────────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname.slice(PREFIX.length) || '/'

      if (req.method === 'GET' && path === '/api/health') {
        return json(res, { ok: true, service: 'prompt-injector', disabled: loadConfig() })
      }

      if (req.method === 'GET' && path === '/api/dump') {
        const sessionId = url.searchParams.get('sessionId') || undefined
        const cfg = loadConfig()
        try {
          const assembly = await ctx.systemPrompt.assemble({ scope: scopeOf(ctx, sessionId) })
          const wrap = (arr, deny) => (arr ?? []).map((x) => ({
            name: x.name,
            origin: originOf(x.name),
            chars: (x.text ?? '').length,
            enabled: !deny.includes(x.name),
            text: x.text ?? '',
          }))
          const sections = wrap(assembly.sections, cfg.sections)
          const contexts = wrap(assembly.contexts, cfg.contexts)
          const tools = (assembly.tools ?? []).map((t) => ({
            name: t.name,
            chars: (t.description ?? '').length + JSON.stringify(t.parameters ?? {}).length,
            enabled: !cfg.tools.includes(t.name),
            text: `# ${t.name}\n\n${t.description ?? ''}\n\n参数 schema:\n${JSON.stringify(t.parameters ?? {}, null, 2)}`,
          }))
          const variables = Object.entries(assembly.variables ?? {}).map(([k, v]) => ({
            name: k, chars: (v ?? '').length, enabled: !cfg.variables.includes(k), text: v ?? '',
          }))
          const sum = (arr) => arr.reduce((n, x) => n + x.chars, 0)
          const on = (arr) => arr.filter((x) => x.enabled)
          return json(res, {
            ok: true,
            at: new Date().toISOString(),
            sessionId: sessionId ?? null,
            disabled: cfg,
            total: { sections: sections.length, contexts: contexts.length, tools: tools.length, variables: variables.length },
            chars: { sections: sum(sections), contexts: sum(contexts), tools: sum(tools), variables: sum(variables) },
            enabledChars: { sections: sum(on(sections)), contexts: sum(on(contexts)), tools: sum(on(tools)), variables: sum(on(variables)) },
            grandChars: sum(sections) + sum(contexts) + sum(tools) + sum(variables),
            enabledGrandChars: sum(on(sections)) + sum(on(contexts)) + sum(on(tools)) + sum(on(variables)),
            sections, contexts, tools, variables,
          })
        } catch (e) {
          return json(res, { ok: false, error: String(e && e.message ? e.message : e) }, 500)
        }
      }

      if (req.method === 'POST' && path === '/api/toggle') {
        let body = {}
        try { body = JSON.parse((await readBody(req)) || '{}') } catch { /* ignore */ }
        const kind = String(body.kind || '')
        const name = String(body.name || '')
        const enabled = body.enabled === true
        if (!KINDS.includes(kind) || !name) {
          return json(res, { ok: false, error: 'kind 必须是 sections/contexts/tools/variables 且 name 非空' }, 400)
        }
        const cfg = loadConfig()
        const set = new Set(cfg[kind])
        if (enabled) set.delete(name); else set.add(name)
        cfg[kind] = [...set]
        try { saveConfig(cfg) } catch (e) { return json(res, { ok: false, error: `写入失败: ${e}` }, 500) }
        return json(res, { ok: true, kind, name, enabled, disabled: cfg })
      }

      if (req.method === 'POST' && path === '/api/reset') {
        let body = {}
        try { body = JSON.parse((await readBody(req)) || '{}') } catch { /* ignore */ }
        const kind = body.kind ? String(body.kind) : null
        const cfg = loadConfig()
        if (kind && KINDS.includes(kind)) cfg[kind] = []
        else for (const k of KINDS) cfg[k] = []
        try { saveConfig(cfg) } catch (e) { return json(res, { ok: false, error: `写入失败: ${e}` }, 500) }
        return json(res, { ok: true, disabled: cfg })
      }

      if (req.method === 'GET' && path === '/api/agents') {
        const home = process.env.DSH_HOME || join(homedir(), '.dsh')
        const files = [
          { path: join(home, 'AGENTS.md'), label: 'AGENTS.md（精简版，每轮注入）' },
          { path: join(home, 'AGENTS-DETAILS.md'), label: 'AGENTS-DETAILS.md（全文版，按需读取）' },
        ]
        const out = files.map((f) => {
          if (!existsSync(f.path)) return { ...f, exists: false, chars: 0, text: '' }
          try { const t = readFileSync(f.path, 'utf8'); return { ...f, exists: true, chars: t.length, text: t } }
          catch (e) { return { ...f, exists: false, chars: 0, text: '', error: String(e) } }
        })
        return json(res, { ok: true, files: out })
      }

      return json(res, { ok: false, error: 'not found' }, 404)
    },
  }), 'prompt-injector: prompt dump + toggle API')
}
