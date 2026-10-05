/**
 * dsh-prompt-injector · 客户端半区
 *
 * 在**设置**里新增一页「提示词注入」，把每一轮对话开始前会被自动注入的内容完整列出来：
 *   ① 系统提示词分段（sections）—— 官方内核/应用层/人设/策略各插件贡献
 *   ② 运行时上下文（contexts）—— 每轮变化的部分（时间、工作区、引用等）
 *   ③ 工具说明（tools）—— 工具名 + 描述 + 参数 schema（全部会进前缀）
 *   ④ 提示词变量（variables）
 *   ⑤ 工作区规则原文（AGENTS.md / AGENTS-DETAILS.md）
 *
 * 每段可展开看**完整原文**、可复制；顶部给出总览（段数 + 字符数），
 * 让用户一眼看出"到底有多少东西被注入了"。
 */
import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'

export const name = 'prompt-injector-client'
export const inject = ['slots']

const PREFIX = '/prompt-injector'

async function getJSON(path) {
  const r = await fetch(PREFIX + path, { cache: 'no-store' })
  return await r.json()
}

function Section({ title, hint, items, tone }) {
  const [open, setOpen] = useState({})
  const [copied, setCopied] = useState('')
  const chars = items.reduce((n, x) => n + (x.chars || 0), 0)
  return h('section', { style: { marginTop: 14 } }, [
    h('div', { key: 'h', style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 } }, [
      h('strong', { key: 't', style: { fontSize: 14, color: tone || 'inherit' } }, title),
      h('span', { key: 'c', style: { fontSize: 12, opacity: 0.6 } }, `${items.length} 段 · ${chars.toLocaleString()} 字符`),
      hint ? h('span', { key: 'n', style: { fontSize: 12, opacity: 0.5 } }, hint) : null,
    ]),
    items.length === 0
      ? h('div', { key: 'e', style: { fontSize: 12, opacity: 0.55, padding: '4px 0' } }, '（无）')
      : h('div', { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        items.map((it, i) => {
          const key = `${it.name}-${i}`
          const isOpen = !!open[key]
          return h('div', {
            key,
            style: { border: '1px solid rgba(128,128,128,.25)', borderRadius: 8, overflow: 'hidden' },
          }, [
            h('div', {
              key: 'hd',
              style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer' },
              onClick: () => setOpen((s) => ({ ...s, [key]: !s[key] })),
            }, [
              h('span', { key: 'i', style: { fontSize: 11, opacity: 0.5, minWidth: 14 } }, isOpen ? '▾' : '▸'),
              h('code', { key: 'n', style: { fontSize: 12.5 } }, it.name),
              it.origin ? h('span', {
                key: 'o',
                style: { fontSize: 11, padding: '1px 7px', borderRadius: 999, background: 'rgba(128,128,128,.15)', opacity: 0.85 },
              }, it.origin) : null,
              h('span', { key: 's', style: { marginLeft: 'auto', fontSize: 11.5, opacity: 0.55 } }, `${(it.chars || 0).toLocaleString()} 字符`),
            ]),
            isOpen ? h('div', { key: 'bd', style: { borderTop: '1px solid rgba(128,128,128,.2)', padding: 10 } }, [
              h('div', { key: 'bar', style: { display: 'flex', gap: 8, marginBottom: 8 } }, [
                h('button', {
                  key: 'cp',
                  type: 'button',
                  style: { fontSize: 11.5, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit' },
                  onClick: async () => {
                    try {
                      await navigator.clipboard.writeText(it.text || '')
                      setCopied(key)
                      setTimeout(() => setCopied(''), 1200)
                    } catch { /* ignore */ }
                  },
                }, copied === key ? '已复制 ✓' : '复制全文'),
                h('span', { key: 'z', style: { fontSize: 11, opacity: 0.5, alignSelf: 'center' } }, `${it.chars} 字符 · 会随每轮请求发给模型`),
              ]),
              h('pre', {
                key: 'pre',
                style: {
                  margin: 0, padding: 10, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word', fontSize: 12, lineHeight: 1.55,
                  background: 'rgba(128,128,128,.08)', borderRadius: 6,
                },
              }, it.text || '（空）'),
            ]) : null,
          ])
        })),
  ])
}

function InjectorPage() {
  const [data, setData] = useState(null)
  const [agents, setAgents] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      const [d, a] = await Promise.all([getJSON('/api/dump'), getJSON('/api/agents')])
      if (d.ok) setData(d); else setErr(d.error || '加载失败')
      if (a.ok) setAgents(a)
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const overview = useMemo(() => {
    if (!data) return null
    const t = data.total, c = data.chars
    const rows = [
      ['系统提示词分段', t.sections, c.sections],
      ['运行时上下文', t.contexts, c.contexts],
      ['工具说明', t.tools, c.tools],
      ['提示词变量', t.variables, c.variables],
    ]
    return h('div', {
      key: 'ov',
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, margin: '10px 0 4px' },
    }, rows.map(([label, n, ch]) => h('div', {
      key: label,
      style: { border: '1px solid rgba(128,128,128,.25)', borderRadius: 8, padding: '8px 10px' },
    }, [
      h('div', { key: 'l', style: { fontSize: 11.5, opacity: 0.6 } }, label),
      h('div', { key: 'v', style: { fontSize: 16, fontWeight: 600 } }, `${n} 段`),
      h('div', { key: 'c', style: { fontSize: 11, opacity: 0.5 } }, `${Number(ch).toLocaleString()} 字符`),
    ])))
  }, [data])

  if (!data && !err) {
    return h('div', { style: { padding: 16, fontSize: 13, opacity: 0.7 } }, '正在读取当前注入内容…')
  }

  return h('div', { style: { padding: '6px 2px 20px' } }, [
    h('div', { key: 'top', style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } }, [
      h('h3', { key: 't', style: { margin: 0, fontSize: 15 } }, '提示词注入总览'),
      h('button', {
        key: 'r',
        type: 'button',
        onClick: () => void load(),
        style: { fontSize: 12, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit' },
      }, busy ? '读取中…' : '重新读取'),
    ]),
    h('p', { key: 'd', style: { fontSize: 12.5, opacity: 0.72, margin: '8px 0 0', lineHeight: 1.6 } },
      '下面是**每一次对话开始前**会被自动拼进请求的内容（按官方 systemPrompt.assemble 的真实组装结果，不是文档描述）。展开任意一段可以看完整原文并复制。'),
    err ? h('div', { key: 'e', style: { color: '#e5484d', fontSize: 12.5, marginTop: 8 } }, `读取失败：${err}`) : null,
    overview,
    data ? h('div', { key: 'g', style: { fontSize: 12, opacity: 0.65, marginTop: 8 } },
      `合计约 ${Number(data.grandChars).toLocaleString()} 字符（≈${Math.round(data.grandChars / 3.2).toLocaleString()} tokens）· 读取于 ${new Date(data.at).toLocaleTimeString()}`) : null,

    data ? h(Section, { key: 's1', title: '① 系统提示词分段（sections）', hint: '固定部分，进前缀缓存', items: data.sections, tone: '#4a7dd6' }) : null,
    data ? h(Section, { key: 's2', title: '② 运行时上下文（contexts）', hint: '每轮变化', items: data.contexts }) : null,
    data ? h(Section, { key: 's3', title: '③ 工具说明（tools）', hint: '工具名 + 描述 + 参数 schema，全部会注入', items: data.tools }) : null,
    data ? h(Section, { key: 's4', title: '④ 提示词变量（variables）', items: data.variables }) : null,
    agents ? h(Section, {
      key: 's5',
      title: '⑤ 工作区规则文件（AGENTS.md 一族）',
      hint: '精简版每轮注入，全文版按需读取',
      items: agents.files.map((f) => ({ name: f.label, origin: f.path, chars: f.chars, text: f.exists ? f.text : '（文件不存在）' })),
    }) : null,
  ])
}

export function apply(ctx) {
  // 自证标记：与 __dshPeakGate / __dshTaskboardApplied 同一惯例，
  // 让"到底有没有执行 apply"这件事可以被外部直接观测（R114：判据要取真值）。
  try {
    window.__dshPromptInjectorApplied = {
      at: new Date().toISOString(),
      hasSlots: !!(ctx && ctx.slots),
      hasInject: typeof ctx?.slots?.inject === 'function',
      hasRegister: typeof ctx?.slots?.register === 'function',
      warns: [],
    }
  } catch (e) { /* ignore */ }
  const mark = (k, v) => { try { window.__dshPromptInjectorApplied[k] = v } catch { /* ignore */ } }

  if (!ctx || !ctx.slots) { mark('warns', ['ctx.slots 不存在']); return }
  if (typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') {
    mark('warns', ['slots.inject/register 不是函数'])
    return
  }
  ctx.effect(() => {
    try {
      const dispose = ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'prompt-injector',
        order: 60,
        label: () => '提示词注入',
      }, InjectorPage))
      mark('registered', true)
      return async () => { void dispose }
    } catch (e) {
      mark('registerError', String(e && e.message ? e.message : e))
      return () => {}
    }
  }, 'prompt-injector: settings page')
}
