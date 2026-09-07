import { parseExpression } from '@babel/parser'

export type AstNode = { type: string; start?: number | null; end?: number | null; [key: string]: unknown }
export function node(value: unknown): AstNode | null {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string' ? value as AstNode : null
}
export function walk(value: unknown, visit: (value: AstNode) => void): void {
  if (Array.isArray(value)) { value.forEach((entry) => walk(entry, visit)); return }
  const current = node(value)
  if (current === null) return
  visit(current)
  for (const [key, child] of Object.entries(current)) if (!['loc', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens'].includes(key)) walk(child, visit)
}
export function expression(source: string): AstNode | null {
  try { return parseExpression(source, { plugins: ['typescript'] }) as unknown as AstNode } catch { return null }
}
export function memberPath(value: unknown): string | null {
  const current = node(value)
  if (current?.type === 'Identifier') return String(current.name)
  if (current?.type !== 'MemberExpression' || current.computed || current.optional) return null
  const object = memberPath(current.object)
  const property = node(current.property)
  return object !== null && property?.type === 'Identifier' ? `${object}.${String(property.name)}` : null
}
export function containsProbe(root: AstNode, dispatcher: string): boolean {
  let found = false
  walk(root, (entry) => {
    if (entry.type !== 'CallExpression' || memberPath(entry.callee) !== dispatcher || !Array.isArray(entry.arguments)) return
    const argument = node(entry.arguments[0])
    if (argument?.type !== 'ObjectExpression' || !Array.isArray(argument.properties)) return
    const fields = new Map(argument.properties.map((property) => {
      const field = node(property)
      return [node(field?.key)?.name, node(field?.value)?.value]
    }))
    if (fields.get('schemaVersion') === 2 && fields.get('source') === 'template') found = true
  })
  return found
}

function safeLeaf(root: AstNode): boolean {
  let safe = true
  walk(root, (entry) => {
    if (entry.type === 'ConditionalExpression' || entry.type === 'SequenceExpression' || entry.type === 'AwaitExpression'
      || entry.type === 'YieldExpression' || entry.type === 'OptionalCallExpression' || entry.type === 'OptionalMemberExpression'
      || entry.type === 'NewExpression' || entry.type === 'TaggedTemplateExpression'
      || (entry.type === 'MemberExpression' && entry.computed)) safe = false
  })
  return safe
}

/** metadata 只补充可直接读取的绑定，不重复执行业务调用或赋值表达式。 */
export function metadataExpression(source: string): string | null {
  const root = expression(source)
  if (root === null || !safeLeaf(root)) return null
  let safe = true
  walk(root, (entry) => {
    if (['CallExpression', 'AssignmentExpression', 'UpdateExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'ObjectMethod', 'SpreadElement'].includes(entry.type)) safe = false
  })
  return safe ? `(${source})` : null
}

type Branch = Readonly<{ name: string; body: (probe: string) => string; fallback: boolean }>
function branch(root: AstNode, source: string, nativeName: string, listener: string): Branch | null {
  if (!safeLeaf(root)) return null
  const original = source.slice(root.start ?? 0, root.end ?? source.length)
  const reference = memberPath(root)
  if (reference !== null) return { name: reference, fallback: false, body: (probe) => `${probe};return ${original}($event)` }
  const calls: AstNode[] = []
  const functions: AstNode[] = []
  walk(root, (entry) => {
    if (entry.type === 'CallExpression') calls.push(entry)
    if (entry.type === 'ArrowFunctionExpression' || entry.type === 'FunctionExpression') functions.push(entry)
  })
  if (calls.length > 1 || calls.some((call) => memberPath(call.callee) === null)) return null
  const name = calls.length === 1 ? memberPath(calls[0]?.callee) as string : nativeName
  if (root.type === 'ArrowFunctionExpression' || root.type === 'FunctionExpression') {
    if (functions.length !== 1 || root.async || root.generator) return null
    const body = node(root.body)
    if (body?.type === 'BlockStatement') {
      const statements = Array.isArray(body.body) ? body.body : []
      if (statements.length > 1 || statements.some((statement) => !['ReturnStatement', 'ExpressionStatement'].includes(node(statement)?.type ?? ''))) return null
    }
    return { name, fallback: calls.length === 0, body: (probe) => `const ${listener}=(${original});${probe};return ${listener}($event)` }
  }
  if (functions.length > 0 || (root.type !== 'CallExpression' && calls.length > 0)) return null
  return { name, fallback: calls.length === 0, body: (probe) => `${probe};return (${original})` }
}

export function rewriteHandler(source: string, nativeName: string, dispatcher: string, probe: (name: string) => string): Readonly<{ code: string; fallback: boolean }> | null {
  const root = expression(source)
  if (root === null) return null
  const listener = `${dispatcher}Listener`
  if (root.type === 'ConditionalExpression') {
    const test = node(root.test)
    const yes = node(root.consequent)
    const no = node(root.alternate)
    if (test === null || yes === null || no === null || !safeLeaf(test)) return null
    const left = branch(yes, source, nativeName, listener)
    const right = branch(no, source, nativeName, listener)
    if (left === null || right === null) return null
    return {
      code: `($event)=>{if(${source.slice(test.start ?? 0, test.end ?? 0)}){${left.body(probe(left.name))}}else{${right.body(probe(right.name))}}}`,
      fallback: left.fallback || right.fallback,
    }
  }
  const result = branch(root, source, nativeName, listener)
  return result === null ? null : { code: `($event)=>{${result.body(probe(result.name))}}`, fallback: result.fallback }
}
