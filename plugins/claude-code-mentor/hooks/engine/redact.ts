// Ochrona danych wrażliwych. Wszystko, co może trafić do dodatkowego
// zapytania modelu albo do lokalnej bazy, przechodzi przez te filtry.

const SENSITIVE_FILE = [
  /(^|[\\/])\.env(\.[\w.-]+)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|asc|gpg|kdbx|ovpn|tfvars|tfstate)$/i,
  /(^|[\\/])id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|[\\/])\.(npmrc|pypirc|netrc|git-credentials|htpasswd|dockercfg)$/i,
  /(^|[\\/])(credentials|secrets?)(\.[\w-]+)?\.(json|ya?ml|toml|ini|txt|xml)$/i,
  /(^|[\\/])service[-_]?account[\w-]*\.json$/i,
  /(^|[\\/])\.aws[\\/]/i,
  /(^|[\\/])\.ssh[\\/]/i,
  /(^|[\\/])wp-config\.php$/i,
]

export function isSensitivePath(path: string | null | undefined): boolean {
  if (!path) return false
  return SENSITIVE_FILE.some(re => re.test(path))
}

type Rule = { name: string; re: RegExp; replace: (m: string, ...g: string[]) => string }

const RULES: Rule[] = [
  { name: 'klucz prywatny', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: () => '[USUNIĘTO: klucz prywatny]' },
  { name: 'token Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{10,}/g, replace: () => '[USUNIĘTO: klucz API]' },
  { name: 'klucz OpenAI', re: /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/g, replace: () => '[USUNIĘTO: klucz API]' },
  { name: 'klucz Stripe', re: /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}/g, replace: () => '[USUNIĘTO: klucz Stripe]' },
  { name: 'token GitHub', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: () => '[USUNIĘTO: token GitHub]' },
  { name: 'token Slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: () => '[USUNIĘTO: token Slack]' },
  { name: 'klucz AWS', re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: () => '[USUNIĘTO: klucz AWS]' },
  { name: 'klucz Google', re: /\bAIza[0-9A-Za-z_-]{30,}/g, replace: () => '[USUNIĘTO: klucz Google]' },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: () => '[USUNIĘTO: JWT]' },
  { name: 'hasło w URL', re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):([^\s@/]{2,})@/gi, replace: (_m, pre) => `${pre}:[USUNIĘTO]@` },
  {
    name: 'sekret w przypisaniu',
    re: /\b([A-Za-z0-9_]*(api[_-]?key|secret|token|passw(or)?d|pwd|auth|private[_-]?key|access[_-]?key|client[_-]?secret)[A-Za-z0-9_]*)(["']?\s*[:=]>?\s*)(["'`])([^"'`\n[]{6,})\5/gi,
    replace: (_m, name, _a, _b, sep, q) => `${name}${sep}${q}[USUNIĘTO]${q}`,
  },
  {
    name: 'sekret w zmiennej środowiskowej',
    re: /^(\s*(export\s+)?[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|DSN|DATABASE_URL)[A-Z0-9_]*\s*=\s*)(\S{6,})$/gm,
    replace: (_m, pre) => `${pre}[USUNIĘTO]`,
  },
  { name: 'długi ciąg losowy', re: /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g, replace: m => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) && !/^[a-z_]+$/i.test(m) ? '[USUNIĘTO: długi token]' : m) },
]

export type Redacted = { text: string; hits: string[] }

export function redact(text: string): Redacted {
  const hits: string[] = []
  let out = text
  for (const r of RULES) {
    out = out.replace(r.re, (...args: unknown[]) => {
      const m = args[0] as string
      const groups = args.slice(1, -2) as string[]
      const rep = r.replace(m, ...groups)
      if (rep !== m) hits.push(r.name)
      return rep
    })
  }
  return { text: out, hits }
}

/** Fragment kodu bezpieczny do pokazania i ewentualnego wysłania. */
export function safeSnippet(path: string | null, text: string, maxLines: number): { text: string; blocked: boolean; hits: string[]; truncated: boolean } {
  if (isSensitivePath(path)) return { text: '', blocked: true, hits: ['plik wrażliwy'], truncated: false }
  const lines = text.split('\n')
  const truncated = lines.length > maxLines
  const r = redact(lines.slice(0, maxLines).join('\n'))
  return { text: r.text, blocked: false, hits: r.hits, truncated }
}
