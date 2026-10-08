// Rozpoznawanie pojęć w rzeczywistym kodzie i komendach. Reguły są jawne
// i deterministyczne: każde trafienie wskazuje linię i dopasowany tekst,
// więc lekcja może pokazać dokładnie, skąd wie, o czym mówi.

type Rule = { id: string; langs?: string[]; re: RegExp; strong?: boolean }

const JS = ['js', 'ts']
const CODE = ['js', 'ts', 'py', 'php', 'java', 'csharp', 'go', 'rust', 'kotlin', 'dart', 'ruby']

const RULES: Rule[] = [
  // podstawy
  { id: 'variables', langs: JS, re: /\b(let|const|var)\s+[A-Za-z_$]/ },
  { id: 'variables', langs: ['php'], re: /\$[A-Za-z_]\w*\s*=[^=]/ },
  { id: 'variables', langs: ['py'], re: /^\s*[a-z_]\w*\s*=[^=]/ },
  { id: 'variables', langs: ['dart'], re: /\b(var|final|late)\s+[A-Za-z_]|\bconst\s+[a-z_]\w*\s*=|^\s*(int|double|String|bool|num)\??\s+[a-z_]\w*\s*[=;]/ },
  { id: 'equality', langs: [...JS, 'php'], re: /[^=!<>]={2,3}[^=]|!==?/, strong: true },
  { id: 'equality', langs: ['py', 'dart'], re: /[^=!<>]==[^=]|!=/ },
  { id: 'boolean-logic', langs: [...JS, 'php', 'java', 'csharp', 'go', 'rust', 'kotlin', 'dart'], re: /&&|\|\|/ },
  { id: 'boolean-logic', langs: ['py'], re: /\b(and|or|not)\b/ },
  { id: 'conditionals', langs: CODE, re: /\bif\s*\(|\bif\s+.+:\s*$|\belse\b|\bswitch\s*\(|\?\s*[^:?.]+\s*:|\bmatch\s*\(/, strong: true },
  { id: 'loops', langs: CODE, re: /\b(for|while)\s*\(|\bfor\s+\w+\s+in\b|\bforeach\s*\(|\.forEach\(|\bdo\s*\{/, strong: true },
  { id: 'functions', langs: CODE, re: /\bfunction\b|=>|\bdef\s+\w+\s*\(|\bfn\s+\w+|\bfunc\s+\w+/, strong: true },
  { id: 'scope', langs: JS, re: /\bvar\s+\w+/ },
  { id: 'closures', langs: JS, re: /return\s+(\([^)]*\)|\w+)\s*=>|return\s+function\b/, strong: true },
  { id: 'strings', re: /`[^`]*\$\{|f["'][^"']*\{|\.(split|trim|replace|toUpperCase|toLowerCase|substring|padStart)\(/ },
  { id: 'null-undefined', langs: [...JS, 'php', 'py'], re: /\?\?|\?\.|\b(null|undefined|None)\b/ },
  { id: 'type-coercion', langs: JS, re: /\b(Number|String|Boolean|parseInt|parseFloat)\(|[^=!]==[^=]|!!\w/ },
  // Rekurencja: wywołanie własnej nazwy w ciele tej samej funkcji (przed kolejną deklaracją funkcji).
  { id: 'recursion', re: /\bfunction\s+(\w+)\s*(?:<[^>]*>)?\([^)]*\)[^{]*\{(?:(?!\bfunction\b|\n\}).)*?\b\1\s*\(/s },
  // Dart i Flutter
  { id: 'dart-basics', langs: ['dart'], re: /\bvoid\s+main\s*\(|~\/|\b(final|late)\s+[A-Za-z_]|'[^'\n]*\$[\w{]|\b(int|double|String|bool|num)\??\s+[a-z_]\w*\s*[=;,)]/ },
  { id: 'dart-null-safety', langs: ['dart'], re: /\b(late|required)\s|\b(int|double|String|bool|num|[A-Z]\w*(<[^>]*>)?)\?\s+[a-z_]|\w!(\.|;|\))|\?\?=?|\?\./, strong: true },
  { id: 'dart-futures-streams', langs: ['dart'], re: /\bFuture(<|\.)|\bStream(<|Controller\b|\.)|\basync\*|\bawait\s+for\b|\bawait\s|\byield\b|\bscheduleMicrotask\(/, strong: true },
  { id: 'flutter-widgets', langs: ['dart'], re: /extends\s+StatelessWidget\b|Widget\s+build\s*\(\s*BuildContext|\brunApp\s*\(|\b(MaterialApp|CupertinoApp|Scaffold|AppBar)\s*\(/, strong: true },
  { id: 'flutter-state', langs: ['dart'], re: /extends\s+(StatefulWidget|State<)|\bsetState\s*\(|\binitState\s*\(|\bdidUpdateWidget\s*\(|\bvoid\s+dispose\s*\(/, strong: true },
  { id: 'flutter-layout', langs: ['dart'], re: /\b(Row|Column|Expanded|Flexible|Padding|SizedBox|Stack|Positioned|ListView(\.builder|\.separated)?|GridView(\.builder|\.count)?|Center|Align|Wrap|Container|SingleChildScrollView|LayoutBuilder)\s*\(/, strong: true },
  { id: 'flutter-navigation', langs: ['dart'], re: /\bNavigator\.(of|push|pop|pushNamed|pushReplacement)\b|\bMaterialPageRoute\b|\bGoRouter\b|\bGoRoute\(|\bcontext\.(go|push|pop|goNamed)\(/, strong: true },
  { id: 'flutter-state-management', langs: ['dart'], re: /\b(ChangeNotifier|ChangeNotifierProvider|MultiProvider|Consumer<|Selector<|ConsumerWidget|ConsumerStatefulWidget|ProviderScope|StateNotifier|BlocProvider|BlocBuilder|BlocListener|Cubit<|InheritedWidget|ValueNotifier|ValueListenableBuilder)\b|\bnotifyListeners\(|\bProvider\.of<|\bcontext\.(watch|read|select)<|\bref\.(watch|read|listen)\(/, strong: true },
  { id: 'flutter-async-ui', langs: ['dart'], re: /\b(FutureBuilder|StreamBuilder)\b|\bConnectionState\.|\bsnapshot\.(hasData|hasError|data|connectionState)\b/, strong: true },
  { id: 'cross-platform-basics', langs: ['dart'], re: /\bPlatform\.(is\w+|operatingSystem)\b|\bkIsWeb\b|\bdefaultTargetPlatform\b|\b(MethodChannel|EventChannel)\(|\bCupertino\w+\(|\.adaptive\(|\bTargetPlatform\./, strong: true },
  { id: 'cross-platform-basics', langs: ['js', 'ts'], re: /\bPlatform\.(OS|select)\b|from\s+['"]react-native['"]|\bNativeModules\b|from\s+['"]expo[\w-/]*['"]/, strong: true },
  // struktury danych
  { id: 'arrays', re: /\[[^\]]*,[^\]]*\]|\.(push|pop|map|filter|reduce|find|some|every|slice|splice|includes)\(|\barray_\w+\(|\bappend\(/ },
  { id: 'objects-maps', re: /\{\s*[\w"']+\s*:|\bnew Map\(|\bdict\(|\[\s*['"]\w+['"]\s*=>/ },
  { id: 'sets', re: /\bnew Set\(|\bset\(\)|\bset\(\[/ },
  { id: 'json', re: /\bJSON\.(parse|stringify)\(|\bjson\.(loads|dumps)\(|\bjson_(encode|decode)\(|\.json\(\)|\bjson(Decode|Encode)\(|\bfromJson\(|\btoJson\(\)/, strong: true },
  { id: 'destructuring-spread', langs: JS, re: /\b(const|let|var)\s*[[{][^=]*[\]}]\s*=|\.\.\.\w/ },
  { id: 'immutability', langs: JS, re: /Object\.freeze\(|\breadonly\b|\bas const\b|\.\.\.state/ },
  // błędy
  { id: 'exceptions', re: /\btry\s*\{|\bcatch\s*\(|\bexcept\b|\bthrow\s+new\b|\braise\s+\w|\bfinally\b|\bthrow\s+[A-Z]\w*(Exception|Error)\(|\bon\s+[A-Z]\w*\s+catch\b/, strong: true },
  // OOP
  { id: 'classes', re: /\bclass\s+\w+|\bnew\s+[A-Z]\w*\(/, strong: true },
  { id: 'inheritance', re: /\bclass\s+\w+\s+extends\s+\w+|\bclass\s+\w+\(\w+\):|\bsuper\(/, strong: true },
  { id: 'this-binding', langs: [...JS, 'php'], re: /\bthis\.\w+|\$this->|\.bind\(this\)/ },
  { id: 'static-typing', langs: ['ts'], re: /:\s*(string|number|boolean|unknown|any|void|Record<|Promise<|[A-Z]\w*(\[\])?)\b|\binterface\s+\w+|\btype\s+\w+\s*=/ },
  { id: 'static-typing', langs: ['py'], re: /def\s+\w+\([^)]*:\s*\w+|->\s*\w+:/ },
  { id: 'generics', langs: ['ts', 'java', 'csharp', 'kotlin', 'rust', 'dart'], re: /\w<[A-Z]\w*(,\s*[A-Z]\w*)*>\s*\(|<T(\s+extends\s+\w+)?>/ },
  // moduły
  { id: 'modules-imports', re: /^\s*(import\s.+from\s|import\s+['"]|export\s+(default|const|function|class|async|type|interface)|from\s+\S+\s+import\s|require\(|use\s+[A-Z]\w*\\)/m, strong: true },
  { id: 'env-config', re: /process\.env\.|import\.meta\.env|os\.environ|getenv\(|\$_ENV|dotenv/, strong: true },
  // async
  { id: 'callbacks', langs: JS, re: /\(\s*(err|error)\s*,\s*\w+\s*\)\s*=>|function\s*\(\s*err\b|setTimeout\(|addEventListener\(/ },
  { id: 'promises', langs: JS, re: /\bnew Promise\(|\.then\(|\.catch\(|Promise\.(all|race|allSettled|any|resolve|reject)\(/, strong: true },
  { id: 'async-await', langs: [...JS, 'py'], re: /\basync\s+(function|def|\(|\w+\s*=>)|\bawait\s/, strong: true },
  { id: 'event-loop', langs: JS, re: /setTimeout\(|setImmediate\(|queueMicrotask\(|process\.nextTick\(/ },
  { id: 'async-errors', langs: JS, re: /\.catch\(|try\s*\{[^}]*\bawait\b/s },
  { id: 'concurrency', re: /Promise\.(all|allSettled|race)\(|asyncio\.gather\(|\bgo\s+\w+\(|\bWorker\(|ThreadPool|\bmutex\b/i, strong: true },
  { id: 'threads-workers', re: /\bnew Worker\(|worker_threads|threading\.Thread|multiprocessing|ThreadPoolExecutor/ },
  // sieć
  { id: 'http-client', re: /\bfetch\(|axios\.|\brequests\.(get|post|put|delete)\(|curl_init\(|HttpClient|\bhttpx\.|\bhttp\.(get|post|put|delete)\(|\bDio\(\)|\bdio\.(get|post|put|delete)\(/, strong: true },
  { id: 'http-basics', re: /\b(GET|POST|PUT|PATCH|DELETE)\b|status\s*(code)?\s*[=:]?\s*[1-5]\d\d\b|\bres\.status\(|Content-Type/ },
  { id: 'rest-api', re: /\/api\/|\bapp\.(get|post|put|patch|delete)\(|\brouter\.(get|post|put|patch|delete)\(|@(Get|Post|app\.route)|Route::/, strong: true },
  { id: 'cors', re: /\bcors\b|Access-Control-Allow/i },
  // SQL
  { id: 'sql-select', re: /\bSELECT\b[\s\S]+?\bFROM\b/i, strong: true },
  { id: 'sql-null', re: /\bIS\s+(NOT\s+)?NULL\b|\bCOALESCE\(|\bIFNULL\(|\bNULLIF\(/i },
  { id: 'sql-join', re: /\b(INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\b[\s\S]*?\bON\b/i, strong: true },
  { id: 'sql-aggregation', re: /\bGROUP\s+BY\b|\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i, strong: true },
  { id: 'sql-transactions', re: /\bBEGIN( TRANSACTION)?\b|\bCOMMIT\b|\bROLLBACK\b|beginTransaction\(|\.transaction\(/i, strong: true },
  { id: 'sql-indexes', re: /\bCREATE\s+(UNIQUE\s+)?INDEX\b|\bINDEX\s+\w+\s*\(/i, strong: true },
  { id: 'sql-relations', re: /\bFOREIGN\s+KEY\b|\bREFERENCES\s+\w+|\bPRIMARY\s+KEY\b|belongsTo|hasMany|ForeignKey\(/i },
  { id: 'orm', re: /\bprisma\.\w+\.(find|create|update|delete)|\.objects\.(filter|get|create)|sequelize|TypeORM|Eloquent|->where\(|knex\(/i },
  { id: 'sql-injection', re: /(query|execute|exec)\(\s*[`'"][^`'"]*\$\{|(query|execute)\(\s*["'][^"']*["']\s*\+|f["']\s*SELECT|\$_(GET|POST)\[[^\]]+\][^;]*(SELECT|INSERT|UPDATE|DELETE)/i, strong: true },
  { id: 'sql-injection', re: /\bprepare\(|\?\s*,|\$\d\b|:\w+\b.*\bexecute\(/ },
  // algorytmy
  { id: 'complexity', re: /for\s*\([^)]*\)\s*\{[^}]*for\s*\(|\.(includes|indexOf|find)\([^)]*\)[^;\n]*\b(for|map|filter)\b/s },
  { id: 'searching-sorting', re: /\.sort\(|\bsorted\(|\busort\(|binarySearch|\bbisect\b/ },
  // testy, debugowanie
  { id: 'unit-tests', re: /\b(describe|it|test|testWidgets|group)\(\s*['"`]|\bexpect\(|\bassert(Equal|True|\.)\b|\bdef test_\w+|@Test\b|PHPUnit|\bpumpWidget\(/, strong: true },
  { id: 'mocking', re: /\bjest\.(fn|mock|spyOn)\(|\bvi\.(fn|mock|spyOn)\(|\bmock\.|\bMock\(|unittest\.mock|sinon\./ },
  { id: 'debugging', re: /\bdebugger\b|\bpdb\.set_trace\(|\bbreakpoint\(\)|\bvar_dump\(|\bdd\(/ },
  { id: 'logging', re: /\bconsole\.(log|error|warn|info)\(|\blogger\.\w+\(|\blogging\.\w+\(|\berror_log\(|\bdebugPrint\(|\blog\(\s*['"]/ },
  // frontend
  { id: 'dom-events', langs: JS, re: /addEventListener\(|document\.(querySelector|getElementById)|\bonClick=|\bonChange=|\.onclick\s*=/ },
  { id: 'react-components', langs: JS, re: /\breturn\s*\(\s*<|<[A-Z]\w*[\s/>]|React\.FC|export\s+default\s+function\s+[A-Z]/, strong: true },
  { id: 'react-state', langs: JS, re: /\buse(State|Reducer|Context)\(/, strong: true },
  { id: 'react-effects', langs: JS, re: /\buse(Effect|LayoutEffect)\(/, strong: true },
  // backend
  { id: 'http-server-routing', re: /\bexpress\(\)|\bapp\.listen\(|createServer\(|FastAPI\(|Flask\(|\bRoute::|\$_SERVER\['REQUEST_METHOD'\]/, strong: true },
  { id: 'middleware', re: /\bapp\.use\(|\bnext\(\)|middleware/i },
  { id: 'authentication', re: /\bjwt\.|jsonwebtoken|session_start\(|\$_SESSION|passport\.|\blogin\b|\bAuthorization\b|bearer/i },
  { id: 'password-hashing', re: /\bbcrypt\b|\bargon2\b|password_hash\(|password_verify\(|scrypt|pbkdf2/i, strong: true },
  // architektura
  { id: 'caching', re: /\bcache\b|\bredis\b|\bmemo(ize)?\b|useMemo\(|lru/i },
  { id: 'validation', re: /\bzod\b|\bz\.object\(|\bjoi\.|\byup\.|filter_var\(|\bvalidate\w*\(|pydantic|BaseModel\)/i, strong: true },
  { id: 'separation-of-concerns', re: /\b(service|repository|controller|handler|usecase)s?\b/i },
  // bezpieczeństwo
  { id: 'xss', re: /innerHTML\s*=|dangerouslySetInnerHTML|htmlspecialchars\(|\bescape(Html)?\(|DOMPurify/, strong: true },
  { id: 'secrets-management', re: /process\.env\.\w*(KEY|SECRET|TOKEN|PASS)|os\.environ\[['"]\w*(KEY|SECRET|TOKEN)|\.env\b/i },
  // devops
  { id: 'docker', re: /^\s*(FROM|RUN|COPY|CMD|ENTRYPOINT|EXPOSE)\s|docker(-compose)?\b|services:\s*$/m, strong: true },
  { id: 'ci-cd', re: /\bruns-on:|\bjobs:|\bsteps:|\buses:\s*actions\//, strong: true },
  // AI
  { id: 'llm-api', re: /@anthropic-ai\/sdk|\banthropic\.|openai\.|messages\.create\(|chat\.completions|\bclaude-[\w.-]+/, strong: true },
  { id: 'prompt-engineering', re: /\bsystem\s*:\s*[`'"]|\bprompt\s*[:=]\s*[`'"]|<instructions>|\bfew-shot/i },
  { id: 'embeddings', re: /\bembedding(s)?\b|\bvector\b|cosine/i },
  { id: 'rag', re: /\bretriev(e|al)\b|\bvector\s*store\b|\bchunk(s|ing)?\b.*\bembed/i },
  { id: 'ai-agents', re: /\btool_use\b|\btools\s*:\s*\[|\bagent(s)?\b.*\bloop\b|@anthropic-ai\/claude-agent-sdk/i },
]

const CONFIG_FILE = /(^|[\\/])(package\.json|tsconfig[\w.-]*\.json|vite\.config\.\w+|webpack\.config\.\w+|\.eslintrc[\w.]*|eslint\.config\.\w+|composer\.json|requirements[\w.-]*\.txt|pyproject\.toml|Dockerfile|docker-compose[\w.-]*\.ya?ml|\.github[\\/]workflows[\\/].+\.ya?ml|\.gitignore|settings\.json|\.prettierrc[\w.]*|next\.config\.\w+|tailwind\.config\.\w+|Cargo\.toml|go\.mod|pubspec\.yaml|analysis_options\.yaml)$/i

export type ConceptHit = { id: string; line: number; text: string; strong: boolean }

/** Pliki, które nie są kodem: tekst, dokumentacja, licencje, listy ignorowanych. */
const PROSE = new Set(['markdown', 'md', 'txt', 'text', 'rst', 'adoc', 'csv', 'svg', 'xml', 'html', 'lock', 'gitignore', 'gitattributes', 'license', ''])
/** Konfiguracja: tylko pojęcia, które naprawdę w niej występują. */
const CONFIG_ONLY: Record<string, string[]> = {
  yaml: ['ci-cd', 'docker', 'env-config', 'secrets-management', 'packages-dependencies'],
  toml: ['packages-dependencies', 'env-config'],
  json: ['packages-dependencies', 'json'],
  dockerfile: ['docker', 'env-config'],
}

export function detectConcepts(lang: string, lines: { line: number; text: string }[], path: string | null = null): ConceptHit[] {
  if (PROSE.has(lang.toLowerCase()) || (path && /(^|[\\/])(LICENSE|COPYING|NOTICE|CHANGELOG|README)(\.[a-z]+)?$/i.test(path))) return []
  const only = CONFIG_ONLY[lang]
  const hits: ConceptHit[] = []
  const seen = new Set<string>()
  const joined = lines.map(l => l.text).join('\n')
  for (const r of RULES) {
    if (only && !only.includes(r.id)) continue
    if (r.langs && !r.langs.includes(lang) && !(lang === 'sql' && r.id.startsWith('sql'))) continue
    if (lang === 'sql' && !r.id.startsWith('sql') && r.id !== 'orm') continue
    // reguły wielowierszowe sprawdzamy na całości, resztę linia po linii
    if (r.re.source.includes('[\\s\\S]') || r.re.flags.includes('s') || r.id === 'recursion') {
      const m = r.re.exec(joined)
      if (m && !seen.has(r.id)) {
        const offset = joined.slice(0, m.index).split('\n').length - 1
        const l = lines[offset]
        hits.push({ id: r.id, line: l?.line ?? lines[0]?.line ?? 1, text: (l?.text ?? '').trim().slice(0, 160), strong: !!r.strong })
        seen.add(r.id)
      }
      continue
    }
    for (const l of lines) {
      if (seen.has(r.id)) break
      if (/^\s*(\/\/|#|\*|--)/.test(l.text) && !r.id.startsWith('docker')) continue
      if (r.re.test(l.text)) {
        hits.push({ id: r.id, line: l.line, text: l.text.trim().slice(0, 160), strong: !!r.strong })
        seen.add(r.id)
      }
    }
  }
  if (path && CONFIG_FILE.test(path) && /package\.json|composer\.json|requirements|pyproject|Cargo|go\.mod|pubspec\.yaml/i.test(path)) {
    if (!seen.has('packages-dependencies')) hits.push({ id: 'packages-dependencies', line: lines[0]?.line ?? 1, text: path, strong: true })
  }
  return hits
}

export function isConfigFile(path: string | null): boolean {
  return !!path && CONFIG_FILE.test(path)
}

/** Nowe symbole: funkcje, klasy, eksporty w dodanych liniach. */
export function newSymbols(lines: { line: number; text: string }[]): string[] {
  const out: string[] = []
  const res = [
    /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    /\bclass\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:async\s+)?def\s+(\w+)/,
    /\binterface\s+([A-Z]\w*)/,
    /^\s*(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)/,
    /^\s*(?:static\s+)?(?:Future<.+>|Stream<.+>|void|int|double|String|bool|num|Widget|dynamic|[A-Z]\w*(?:<[^>]*>)?\??)\s+([a-z_]\w*)\s*\([^;]*$/,
  ]
  for (const l of lines) {
    for (const re of res) {
      const m = re.exec(l.text)
      if (m?.[1] && !out.includes(m[1])) out.push(m[1])
    }
  }
  return out.slice(0, 12)
}

export type BashFacts = {
  kind: 'dependency' | 'test' | 'build' | 'git' | 'bash'
  concepts: string[]
  summary: string
  packages: string[]
}

export function classifyCommand(cmd: string): BashFacts {
  const c = cmd.trim()
  const pk = /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b([^&|;]*)|\bpip3?\s+install\b([^&|;]*)|\bcomposer\s+require\b([^&|;]*)|\bcargo\s+add\b([^&|;]*)|\bgo\s+get\b([^&|;]*)|\b(?:flutter|dart)\s+pub\s+(?:add|get|upgrade)\b([^&|;]*)/i.exec(c)
  if (pk) {
    const list = (pk[3] ?? pk[4] ?? pk[5] ?? pk[6] ?? pk[7] ?? pk[8] ?? '').split(/\s+/).filter(x => x && !x.startsWith('-'))
    return { kind: 'dependency', concepts: ['packages-dependencies'], summary: list.length ? `Dodanie zależności: ${list.join(', ')}` : 'Instalacja zależności projektu', packages: list }
  }
  if (/\b(jest|vitest|mocha|pytest|phpunit|go\s+test|cargo\s+test|npm\s+(run\s+)?test|pnpm\s+test|yarn\s+test|node\s+--test|playwright\s+test|flutter\s+test|dart\s+test)\b/i.test(c)) {
    return { kind: 'test', concepts: ['unit-tests'], summary: 'Uruchomienie testów', packages: [] }
  }
  if (/\bflutter\s+(build|run|create)\b|\bdart\s+(compile|run|create)\b/i.test(c)) {
    const create = /\b(flutter|dart)\s+create\b/i.test(c)
    return { kind: 'build', concepts: [create ? 'flutter-widgets' : 'cross-platform-basics'], summary: create ? 'Nowy projekt Flutter/Dart' : /\brun\b/i.test(c) ? 'Uruchomienie aplikacji Flutter/Dart' : 'Budowanie aplikacji Flutter/Dart', packages: [] }
  }
  if (/\b(flutter|dart)\s+analyze\b/i.test(c)) return { kind: 'build', concepts: ['dart-null-safety'], summary: 'Analiza statyczna kodu Darta', packages: [] }
  if (/\b(tsc|vite\s+build|webpack|next\s+build|npm\s+run\s+build|cargo\s+build|go\s+build|docker\s+build|make\b|gradle|mvn)\b/i.test(c)) {
    return { kind: 'build', concepts: /docker/i.test(c) ? ['docker'] : ['modules-imports'], summary: 'Budowanie projektu', packages: [] }
  }
  if (/^\s*git\s/.test(c) || /&&\s*git\s/.test(c)) {
    // Tylko operacje, które coś zmieniają w historii; odczyty (status, log, grep, diff) to szum.
    if (!/\bgit\s+(commit|push|pull|merge|rebase|checkout|switch|branch|tag|reset|revert|cherry-pick|stash|init|clone)\b/.test(c)) {
      return { kind: 'bash', concepts: [], summary: c.length > 80 ? c.slice(0, 77) + '…' : c, packages: [] }
    }
    const branch = /\bgit\s+(checkout|switch|branch|merge|rebase)\b/.test(c)
    return { kind: 'git', concepts: branch ? ['git-branching'] : ['git-basics'], summary: `Operacja git: ${c.split(/\s+/).slice(0, 3).join(' ')}`, packages: [] }
  }
  if (/\bdocker(-compose)?\b/.test(c)) return { kind: 'build', concepts: ['docker'], summary: 'Operacja Docker', packages: [] }
  return { kind: 'bash', concepts: [], summary: c.length > 80 ? c.slice(0, 77) + '…' : c, packages: [] }
}
