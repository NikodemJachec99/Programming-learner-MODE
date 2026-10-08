// Drzewo składni podzbioru JS/TS. `start`/`end` to pozycje w źródle,
// `line` to numer linii (od 1), `opStart` wskazuje operator do podmiany.

type Base = { start: number; end: number; line: number }

export type Expr =
  | (Base & { type: 'Num'; value: number; raw: string })
  | (Base & { type: 'Str'; value: string })
  | (Base & { type: 'Template'; parts: ({ kind: 'text'; text: string } | { kind: 'expr'; expr: Expr })[] })
  | (Base & { type: 'Bool'; value: boolean })
  | (Base & { type: 'Null' })
  | (Base & { type: 'Undef' })
  | (Base & { type: 'Ident'; name: string })
  | (Base & { type: 'This' })
  | (Base & { type: 'Array'; items: (Expr | SpreadEl)[] })
  | (Base & { type: 'Object'; props: ObjProp[] })
  | (Base & { type: 'Member'; object: Expr; prop: Expr; computed: boolean; optional: boolean })
  | (Base & { type: 'Call'; callee: Expr; args: (Expr | SpreadEl)[]; optional: boolean })
  | (Base & { type: 'New'; callee: Expr; args: (Expr | SpreadEl)[] })
  | (Base & { type: 'Unary'; op: string; arg: Expr })
  | (Base & { type: 'Update'; op: '++' | '--'; prefix: boolean; arg: Expr })
  | (Base & { type: 'Binary'; op: string; left: Expr; right: Expr; opStart: number })
  | (Base & { type: 'Logical'; op: '&&' | '||' | '??'; left: Expr; right: Expr; opStart: number })
  | (Base & { type: 'Cond'; test: Expr; cons: Expr; alt: Expr })
  | (Base & { type: 'Assign'; op: string; target: Expr; value: Expr })
  | (Base & { type: 'Func'; name: string | null; params: Param[]; body: Stmt[] | Expr; isArrow: boolean; isAsync: boolean })
  | (Base & { type: 'Await'; arg: Expr })
  | (Base & { type: 'Seq'; items: Expr[] })

export type SpreadEl = Base & { type: 'Spread'; arg: Expr }
export type ObjProp = { key: string; value: Expr; computed?: Expr; spread?: boolean }
export type Param = { name: string; default?: Expr; rest?: boolean }

export type Stmt =
  | (Base & { type: 'VarDecl'; kind: 'let' | 'const' | 'var'; decls: { name: string; init: Expr | null; pattern?: Pattern }[] })
  | (Base & { type: 'FuncDecl'; func: Extract<Expr, { type: 'Func' }> })
  | (Base & { type: 'ClassDecl'; name: string; superClass: Expr | null; ctor: Extract<Expr, { type: 'Func' }> | null; methods: { name: string; func: Extract<Expr, { type: 'Func' }>; isStatic: boolean }[]; fields: { name: string; init: Expr | null }[] })
  | (Base & { type: 'Return'; arg: Expr | null })
  | (Base & { type: 'If'; test: Expr; cons: Stmt; alt: Stmt | null })
  | (Base & { type: 'While'; test: Expr; body: Stmt })
  | (Base & { type: 'DoWhile'; test: Expr; body: Stmt })
  | (Base & { type: 'For'; init: Stmt | null; test: Expr | null; update: Expr | null; body: Stmt })
  | (Base & { type: 'ForOf'; kind: 'let' | 'const' | 'var'; name: string; pattern?: Pattern; iter: Expr; body: Stmt; isIn: boolean })
  | (Base & { type: 'Break' })
  | (Base & { type: 'Continue' })
  | (Base & { type: 'Block'; body: Stmt[] })
  | (Base & { type: 'Expr'; expr: Expr })
  | (Base & { type: 'Throw'; arg: Expr })
  | (Base & { type: 'Try'; block: Stmt[]; param: string | null; handler: Stmt[] | null; finalizer: Stmt[] | null })
  | (Base & { type: 'Switch'; disc: Expr; cases: { test: Expr | null; body: Stmt[]; line: number }[] })
  | (Base & { type: 'Empty' })

export type Pattern =
  | { type: 'ArrayPattern'; names: (string | null)[]; rest?: string }
  | { type: 'ObjectPattern'; props: { key: string; name: string; default?: Expr }[]; rest?: string }

export type Program = { body: Stmt[]; source: string }

export type FuncNode = Extract<Expr, { type: 'Func' }>
