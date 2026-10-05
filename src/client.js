/**
 * dsh-prompt-injector · 客户端半区
 *
 * 在**设置**里新增一页「提示词注入」：
 *   ① 列出每一轮会被自动注入的全部内容（系统提示词分段 / 运行时上下文 / 工具说明 / 变量 / AGENTS.md）
 *   ② 每段一个**开关**：关掉的段**真的不会进请求**（宿主侧走官方 system-prompt/assemble 瀑布删除），
 *      不是视觉隐藏 —— 顶部实时显示"已启用 / 全部"的字符数与 token 估算差额
 */
import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'

export const name = 'prompt-injector-client'
export const inject = ['slots']

const PREFIX = '/prompt-injector'

async function getJSON(path) {
  const r = await fetch(PREFIX + path, { cache: 'no-store' })
  return await r.json()
}
async function postJSON(path, body) {
  const r = await fetch(PREFIX + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  return await r.json()
}

const btnStyle = {
  fontSize: 11.5, padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit',
}

/** 每段一行：开关 + 名字 + 来源 + 字符数 + 展开看原文 */
function Row({ kind, item, onToggle, busy }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  return h('div', {
    style: {
      border: '1px solid rgba(128,128,128,.25)', borderRadius: 8, overflow: 'hidden',
      opacity: item.enabled ? 1 : 0.45, background: item.enabled ? 'transparent' : 'rgba(128,128,128,.06)',
    },
  }, [
    h('div', { key: 'hd', style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' } }, [
      h('input', {
        key: 'sw', type: 'checkbox', checked: !!item.enabled, disabled: busy,
        title: item.enabled ? '点击禁用：这一段将不再进入请求' : '点击启用',
        style: { cursor: 'pointer', flex: '0 0 auto' },
        onChange: (e) => onToggle(kind, item.name, e.target.checked),
      }),
      h('span', {
        key: 'i', style: { fontSize: 11, opacity: 0.5, cursor: 'pointer', minWidth: 12 },
        onClick: () => setOpen((v) => !v),
      }, open ? '▾' : '▸'),
      h('code', {
        key: 'n', style: { fontSize: 12.5, cursor: 'pointer', textDecoration: item.enabled ? 'none' : 'line-through' },
        onClick: () => setOpen((v) => !v),
      }, item.name),
      item.origin ? h('span', {
        key: 'o', style: { fontSize: 11, padding: '1px 7px', borderRadius: 999, background: 'rgba(128,128,128,.15)', opacity: 0.85 },
      }, item.origin) : null,
      h('span', { key: 's', style: { marginLeft: 'auto', fontSize: 11.5, opacity: 0.55 } }, `${(item.chars || 0).toLocaleString()} 字符`),
    ]),
    open ? h('div', { key: 'bd', style: { borderTop: '1px solid rgba(128,128,128,.2)', padding: 10 } }, [
      h('div', { key: 'bar', style: { display: 'flex', gap: 8, marginBottom: 8 } }, [
        h('button', {
          key: 'cp', type: 'button', style: btnStyle,
          onClick: async () => {
            try { await navigator.clipboard.writeText(item.text || ''); setCopied(true); setTimeout(() => setCopied(false), 1200) } catch { /* ignore */ }
          },
        }, copied ? '已复制 ✓' : '复制全文'),
        h('span', { key: 'z', style: { fontSize: 11, opacity: 0.5, alignSelf: 'center' } }, `${item.chars} 字符`),
      ]),
      h('pre', {
        key: 'pre',
        style: {
          margin: 0, padding: 10, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap',
          wordBreak: 'break-word', fontSize: 12, lineHeight: 1.55,
          background: 'rgba(128,128,128,.08)', borderRadius: 6,
        },
      }, item.text || '（空）'),
    ]) : null,
  ])
}

function Group({ kind, title, hint, items, onToggle, onResetAll, busy, tone, readonly }) {
  const [disabledFirst, setDisabledFirst] = useState(false)
  const [filter, setFilter] = useState('')
  const total = items.reduce((n, x) => n + (x.chars || 0), 0)
  const onChars = items.filter((x) => x.enabled).reduce((n, x) => n + (x.chars || 0), 0)
  const offCount = items.filter((x) => !x.enabled).length
  const list = useMemo(() => {
    let l = items
    if (filter.trim()) {
      const q = filter.trim().toLowerCase()
      l = l.filter((x) => x.name.toLowerCase().includes(q) || (x.origin || '').toLowerCase().includes(q))
    }
    return disabledFirst ? [...l].sort((a, b) => Number(a.enabled) - Number(b.enabled)) : l
  }, [items, filter, disabledFirst])
  return h('section', { style: { marginTop: 16 } }, [
    h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' } }, [
      h('strong', { key: 't', style: { fontSize: 14, color: tone || 'inherit' } }, title),
      h('span', { key: 'c', style: { fontSize: 12, opacity: 0.6 } },
        `${items.length} 段` + (readonly ? '' : ` · 启用 ${items.length - offCount} / 禁用 ${offCount}`) +
        ` · ${Number(onChars).toLocaleString()} / ${Number(total).toLocaleString()} 字符`),
      hint ? h('span', { key: 'n', style: { fontSize: 12, opacity: 0.5 } }, hint) : null,
      (!readonly && offCount > 0) ? h('button', {
        key: 'rs', type: 'button', style: { ...btnStyle, marginLeft: 'auto' },
        onClick: () => onResetAll(kind),
      }, '全部启用') : null,
    ]),
    items.length > 6 ? h('div', { key: 'tools', style: { display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' } }, [
      h('input', {
        key: 'f', type: 'text', placeholder: '过滤名字…', value: filter,
        style: { flex: '1 1 160px', maxWidth: 260, fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.35)', background: 'transparent', color: 'inherit' },
        onChange: (e) => setFilter(e.target.value),
      }),
      h('button', { key: 's', type: 'button', style: btnStyle, onClick: () => setDisabledFirst((v) => !v) },
        disabledFirst ? '按原顺序' : '禁用的排前面'),
    ]) : null,
    items.length === 0
      ? h('div', { key: 'e', style: { fontSize: 12, opacity: 0.55, padding: '4px 0' } }, '（无）')
      : h('div', { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        list.map((it) => h(Row, { key: it.name, kind, item: it, onToggle, busy }))),
  ])
}

function InjectorPage() {
  const [data, setData] = useState(null)
  const [agents, setAgents] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')

  const load = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      const [d, a] = await Promise.all([getJSON('/api/dump'), getJSON('/api/agents')])
      if (d.ok) setData(d); else setErr(d.error || '加载失败')
      if (a.ok) setAgents(a)
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggle = useCallback(async (kind, name, enabled) => {
    setData((d) => d ? { ...d, [kind]: d[kind].map((x) => x.name === name ? { ...x, enabled } : x) } : d)
    setBusy(true)
    try {
      const r = await postJSON('/api/toggle', { kind, name, enabled })
      if (!r.ok) { setErr(r.error || '切换失败'); await load() }
      else {
        setFlash(`${enabled ? '已启用' : '已禁用'} ${name}（下一轮请求即生效）`)
        setTimeout(() => setFlash(''), 2600)
        await load()
      }
    } catch (e) { setErr(String(e)); await load() } finally { setBusy(false) }
  }, [load])

  const resetAll = useCallback(async (kind) => {
    setBusy(true)
    try {
      const r = await postJSON('/api/reset', kind ? { kind } : {})
      if (r.ok) { setFlash('已全部启用'); setTimeout(() => setFlash(''), 2000); await load() }
      else setErr(r.error || '重置失败')
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }, [load])

  const overview = useMemo(() => {
    if (!data) return null
    const t = data.total, c = data.chars, e = data.enabledChars
    const rows = [
      ['系统提示词分段', t.sections, c.sections, e.sections],
      ['运行时上下文', t.contexts, c.contexts, e.contexts],
      ['工具说明', t.tools, c.tools, e.tools],
      ['提示词变量', t.variables, c.variables, e.variables],
    ]
    return h('div', {
      key: 'ov',
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8, margin: '10px 0 4px' },
    }, rows.map(([label, n, ch, on]) => h('div', {
      key: label,
      style: { border: '1px solid rgba(128,128,128,.25)', borderRadius: 8, padding: '8px 10px' },
    }, [
      h('div', { key: 'l', style: { fontSize: 11.5, opacity: 0.6 } }, label),
      h('div', { key: 'v', style: { fontSize: 15, fontWeight: 600 } }, `${n} 段`),
      h('div', { key: 'c', style: { fontSize: 11, opacity: 0.55 } },
        `${Number(on).toLocaleString()} / ${Number(ch).toLocaleString()} 字符`),
    ])))
  }, [data])

  if (!data && !err) return h('div', { style: { padding: 16, fontSize: 13, opacity: 0.7 } }, '正在读取当前注入内容…')

  const saved = data ? data.grandChars - data.enabledGrandChars : 0

  return h('div', { style: { padding: '6px 2px 20px' } }, [
    h('div', { key: 'top', style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } }, [
      h('h3', { key: 't', style: { margin: 0, fontSize: 15 } }, '提示词注入总览'),
      h('button', { key: 'r', type: 'button', onClick: () => void load(), style: btnStyle }, busy ? '读取中…' : '重新读取'),
      (data && saved > 0) ? h('button', { key: 'a', type: 'button', style: btnStyle, onClick: () => void resetAll(null) }, '全部启用') : null,
      flash ? h('span', { key: 'f', style: { fontSize: 12, color: '#4a7dd6' } }, flash) : null,
    ]),
    h('p', { key: 'd', style: { fontSize: 12.5, opacity: 0.72, margin: '8px 0 0', lineHeight: 1.6 } },
      '下面是每一次对话开始前会被自动拼进请求的内容（取自官方 systemPrompt.assemble 的真实组装结果）。' +
      '每段左侧的勾选框可以真正关掉它 —— 关掉的段不会再进入请求，省下的是真实 token。'),
    err ? h('div', { key: 'e', style: { color: '#e5484d', fontSize: 12.5, marginTop: 8 } }, `错误：${err}`) : null,
    overview,
    data ? h('div', { key: 'g', style: { fontSize: 12, opacity: 0.7, marginTop: 8 } },
      `当前启用约 ${Number(data.enabledGrandChars).toLocaleString()} 字符（≈${Math.round(data.enabledGrandChars / 3.2).toLocaleString()} tokens）` +
      (saved > 0 ? ` · 已关闭 ${Number(saved).toLocaleString()} 字符（≈${Math.round(saved / 3.2).toLocaleString()} tokens/轮）` : ' · 全部启用中') +
      ` · 读取于 ${new Date(data.at).toLocaleTimeString()}`) : null,

    data ? h(Group, { key: 'g1', kind: 'sections', title: '① 系统提示词分段（sections）', hint: '固定部分，进前缀缓存', items: data.sections, onToggle: toggle, onResetAll: resetAll, busy, tone: '#4a7dd6' }) : null,
    data ? h(Group, { key: 'g2', kind: 'contexts', title: '② 运行时上下文（contexts）', hint: '每轮变化', items: data.contexts, onToggle: toggle, onResetAll: resetAll, busy }) : null,
    data ? h(Group, { key: 'g3', kind: 'tools', title: '③ 工具说明（tools）', hint: '工具名 + 描述 + 参数 schema，占大头', items: data.tools, onToggle: toggle, onResetAll: resetAll, busy }) : null,
    data ? h(Group, { key: 'g4', kind: 'variables', title: '④ 提示词变量（variables）', items: data.variables, onToggle: toggle, onResetAll: resetAll, busy }) : null,
    agents ? h(Group, {
      key: 'g5', kind: 'agents', readonly: true, busy: true,
      title: '⑤ 工作区规则文件（AGENTS.md 一族）',
      hint: '文件本身：要改内容请编辑文件（本组不适用开关）',
      items: agents.files.map((f) => ({ name: f.label, origin: f.path, chars: f.chars, enabled: true, text: f.exists ? f.text : '（文件不存在）' })),
      onToggle: () => {}, onResetAll: () => {},
    }) : null,
  ])
}

export function apply(ctx) {
  try {
    window.__dshPromptInjectorApplied = {
      at: new Date().toISOString(),
      hasSlots: !!(ctx && ctx.slots),
      hasInject: typeof ctx?.slots?.inject === 'function',
      hasRegister: typeof ctx?.slots?.register === 'function',
      warns: [],
    }
  } catch { /* ignore */ }
  const mark = (k, v) => { try { window.__dshPromptInjectorApplied[k] = v } catch { /* ignore */ } }

  if (!ctx || !ctx.slots) { mark('warns', ['ctx.slots 不存在']); return }
  if (typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') {
    mark('warns', ['slots.inject/register 不是函数']); return
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
