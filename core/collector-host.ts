/** RFC 3492 §6.1/6.3, using its Punycode parameters; no Node or browser APIs. */
function encodeLabel(label: string): string | null {
  const points = Array.from(label, (character) => character.codePointAt(0)!)
  // DNS labels are bounded. This also bounds the encoder's repeated scans.
  if (points.length > 63) return null
  let output = points.filter((point) => point < 128).map((point) => String.fromCharCode(point)).join('')
  const basic = output.length
  let handled = basic
  if (basic > 0) output += '-'
  let next = 128, delta = 0, bias = 72
  const digit = (value: number): string => String.fromCharCode(value < 26 ? 97 + value : 22 + value)
  while (handled < points.length) {
    const minimum = Math.min(...points.filter((point) => point >= next))
    delta += (minimum - next) * (handled + 1)
    next = minimum
    for (const point of points) {
      if (point < next) delta += 1
      if (point !== next) continue
      let remainder = delta
      for (let weight = 36; ; weight += 36) {
        const threshold = Math.max(1, Math.min(26, weight - bias))
        if (remainder < threshold) break
        output += digit(threshold + ((remainder - threshold) % (36 - threshold)))
        remainder = Math.floor((remainder - threshold) / (36 - threshold))
      }
      output += digit(remainder)
      let adjusted = handled === basic ? Math.floor(delta / 700) : Math.floor(delta / 2)
      adjusted += Math.floor(adjusted / (handled + 1))
      let step = 0
      while (adjusted > 455) { adjusted = Math.floor(adjusted / 35); step += 36 }
      bias = step + Math.floor((36 * adjusted) / (adjusted + 38))
      delta = 0
      handled += 1
    }
    delta += 1
    next += 1
  }
  return output.length + 4 <= 63 ? `xn--${output}` : null
}

/**
 * App fallback for common IDNs: normalize width/dots/case, reject control,
 * private-use, unpaired-surrogate and leading-mark labels, then RFC 3492 encode.
 * This deliberately is not a complete UTS #46 implementation. Hosts with URL
 * use their full IDNA implementation; this path needs no Unicode mapping table.
 */
function asciiDomain(host: string): string | null {
  const normalized = host.replace(/[\u3002\uFF0E\uFF61]/g, '.').normalize('NFKC')
    .replace(/./gu, (character) => character.toLowerCase()).normalize('NFC')
  if (/[\p{C}\p{Z}]/u.test(normalized)) return null
  const labels: string[] = []
  for (const label of normalized.split('.')) {
    if (/^\p{M}/u.test(label)) return null
    const encoded = /[^\x00-\x7F]/.test(label) ? encodeLabel(label) : label
    if (encoded === null || !/^[a-z\d_-]*$/.test(encoded)) return null
    labels.push(encoded)
  }
  const result = labels.join('.')
  return result === '' ? null : result
}

function ipv4Number(part: string): number | null {
  if (part === '') return null
  const hex = /^0x/i.test(part)
  const octal = !hex && part.length > 1 && part.startsWith('0')
  const digits = hex ? part.slice(2) : octal ? part.slice(1) : part
  if (!(hex ? /^[a-f\d]*$/i : octal ? /^[0-7]*$/ : /^\d+$/).test(digits)) return null
  const result = digits === '' ? 0 : Number.parseInt(digits, hex ? 16 : octal ? 8 : 10)
  return Number.isSafeInteger(result) ? result : null
}

/** WHATWG URL §3.5: retain legacy IPv4 input forms, serialize dotted decimal. */
function normalizeIpv4(host: string): string | null {
  const parts = host.split('.')
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
  const last = parts[parts.length - 1]!
  if (!/^(?:\d+|0x[a-f\d]*)$/i.test(last)) return host
  if (parts.length > 4) return null
  const numbers = parts.map(ipv4Number)
  if (numbers.some((value) => value === null)) return null
  const values = numbers as number[]
  if (values.slice(0, -1).some((value) => value > 255) || values[values.length - 1]! >= 256 ** (5 - values.length)) return null
  const address = values.slice(0, -1).reduce((sum, value, at) => sum + value * 256 ** (3 - at), values[values.length - 1]!)
  return [24, 16, 8, 0].map((shift) => (address >>> shift) & 255).join('.')
}

function validIpv6(host: string): boolean {
  let address = host.slice(1, -1)
  if (address.includes('.')) {
    const boundary = address.lastIndexOf(':')
    const tail = address.slice(boundary + 1).split('.')
    if (tail.length !== 4 || tail.some((part) => !/^(?:0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return false
    address = `${address.slice(0, boundary + 1)}0:0`
  }
  const halves = address.split('::')
  if (halves.length > 2) return false
  const groups = halves.flatMap((half) => half === '' ? [] : half.split(':'))
  return groups.every((group) => /^[a-f\d]{1,4}$/i.test(group)) &&
    (halves.length === 2 ? groups.length < 8 : groups.length === 8)
}

export function normalizeCollectorHost(host: string): string | null {
  if (host.startsWith('[')) return validIpv6(host) ? host.toLowerCase() : null
  const domain = asciiDomain(host)
  return domain === null ? null : normalizeIpv4(domain)
}
