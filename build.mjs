/**
 * 构建脚本：把 src/client.js 打包成 DSH 客户端要求的 __ModuleLoader__ 形态。
 *
 * 为什么要这一步：DSH 的客户端模块必须由 window.__ModuleLoader__.load({...}) 包裹，
 * 且 react 等由宿主的模块图提供（external），不能打进包里。参考 dsh-prompt-peek 的做法。
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

// ── 宿主半区：纯 ESM，直接复制即可（只 import node: 内建模块）──────────────
await build({
  entryPoints: ['src/index.js'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['node:*'],
  logLevel: 'info',
})

// ── 客户端半区：包成 __ModuleLoader__ 形态 ────────────────────────────────
await build({
  entryPoints: ['src/client.js'],
  outfile: 'lib/client.js',
  bundle: true,
  // ⚠️ 必须是 cjs：DSH loader 读的是 module.exports.apply。
  // 用 iife 时 esbuild 不会把 ESM 导出写进 module.exports，结果报
  // "invalid plugin, expect function or object with an apply method, received object"。
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: ['react', 'react-dom'],
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      '  id: "dsh-prompt-injector",',
      '  factory: (require) => {',
      '    var module = { exports: {} };',
      '    var exports = module.exports;',
    ].join('\n'),
  },
  footer: {
    js: [
      '    return module.exports;',
      '  },',
      '});',
    ].join('\n'),
  },
  logLevel: 'info',
})

console.log('构建完成：lib/index.js + lib/client.js')
