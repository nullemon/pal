/**
 * A streaming reader for `mysqldump` output (docs/09, docs/17 §E).
 *
 * The dump of a real WordPress install is measured in gigabytes and a single extended
 * `INSERT` can be tens of megabytes, so nothing here ever holds the file — or a whole
 * statement — in memory. Characters go in, {@link SqlDumpEvent}s come out: one event per
 * `CREATE TABLE` (for the column order the positional inserts need) and one per inserted
 * row. Everything retained between chunks is the token currently being lexed plus the head
 * of the statement being classified, both bounded by the largest single column value.
 *
 * Written by hand: the importer takes no new dependency for this.
 */

/** One value inside a `VALUES (…)` tuple, as the dump wrote it. */
export type SqlLiteral =
  | { readonly type: 'null' }
  | { readonly type: 'number'; readonly value: string }
  | { readonly type: 'string'; readonly value: string }
  /** `0x4d79…`, `X'4d79…'` or `_binary '…'`. */
  | { readonly type: 'binary'; readonly value: Uint8Array }
  /** A bare word the dump used as a value: `DEFAULT`, `TRUE`, `CURRENT_TIMESTAMP`. */
  | { readonly type: 'word'; readonly value: string }

export interface SqlCreateTableEvent {
  readonly kind: 'create-table'
  /** Lower-cased, unqualified, backticks removed. */
  readonly table: string
  /** Declared column order — what a positional `INSERT … VALUES` is indexed by. */
  readonly columns: readonly string[]
}

export interface SqlInsertRowEvent {
  readonly kind: 'insert-row'
  /** Lower-cased, unqualified, backticks removed. */
  readonly table: string
  /** The statement's explicit column list, or null for the positional form. */
  readonly columns: readonly string[] | null
  readonly values: readonly SqlLiteral[]
}

export type SqlDumpEvent = SqlCreateTableEvent | SqlInsertRowEvent

const decoder = new TextDecoder('utf-8')
const encoder = new TextEncoder()

/** The text of a literal, or null for SQL `NULL`. Binary is decoded as UTF-8. */
export const sqlText = (value: SqlLiteral | undefined): string | null => {
  if (value === undefined) return null
  switch (value.type) {
    case 'null':
      return null
    case 'binary':
      return decoder.decode(value.value)
    default:
      return value.value
  }
}

/** The text of a literal, with SQL `NULL` and a missing column collapsing to `''`. */
export const sqlString = (value: SqlLiteral | undefined): string => sqlText(value) ?? ''

/** An integer column, with anything unparseable falling back. */
export const sqlInt = (value: SqlLiteral | undefined, fallback = 0): number => {
  const text = sqlText(value)
  if (text === null) return fallback
  const n = Number.parseInt(text.trim(), 10)
  return Number.isNaN(n) ? fallback : n
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

type TokenKind = 'word' | 'ident' | 'string' | 'number' | 'hex' | 'punct'

interface SqlToken {
  readonly kind: TokenKind
  readonly text: string
}

type LexMode =
  | 'top'
  | 'dash'
  | 'slash'
  | 'lineComment'
  | 'blockComment'
  | 'word'
  | 'number'
  | 'hex'
  | 'quoted'
  | 'ident'

const isSpace = (c: string): boolean =>
  c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f' || c === '\v'

const isDigit = (c: string): boolean => c >= '0' && c <= '9'

const isWordStart = (c: string): boolean =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$' || c > '\u007f'

const isWordChar = (c: string): boolean => isWordStart(c) || isDigit(c)

const isHexDigit = (c: string): boolean =>
  isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')

/**
 * MySQL's backslash escapes. `\%` and `\_` keep their backslash — that is the documented
 * behaviour, because those two are the LIKE wildcards — and any other escaped character
 * stands for itself.
 */
const ESCAPES: Readonly<Record<string, string>> = {
  '0': '\u0000',
  b: '\b',
  n: '\n',
  r: '\r',
  t: '\t',
  Z: '\u001a',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '%': '\\%',
  _: '\\_',
}

/**
 * Character-level, fully resumable: every multi-character construct (a string literal, a
 * `/* … *\/` comment, a doubled `''`, a `--` opener) survives an arbitrary chunk boundary,
 * including one that falls between the two characters of an escape. Nothing is re-scanned,
 * so feeding a dump one byte at a time costs the same as feeding it in one piece.
 */
class SqlLexer {
  private mode: LexMode = 'top'
  private acc = ''
  private quote = "'"
  private escaped = false
  /** Saw a closing quote/backtick; the next character decides doubling vs end-of-token. */
  private closing = false
  /** Inside a block comment, the previous character was `*`. */
  private star = false
  /** In a number, the previous character was the exponent marker, so `+`/`-` may follow. */
  private expSign = false

  feed(text: string, out: SqlToken[]): void {
    const n = text.length
    let i = 0
    while (i < n) {
      const c = text[i] as string
      switch (this.mode) {
        case 'top': {
          i += 1
          if (isSpace(c)) break
          if (c === '-') this.mode = 'dash'
          else if (c === '/') this.mode = 'slash'
          else if (c === '#') this.mode = 'lineComment'
          else if (c === '`') {
            this.mode = 'ident'
            this.acc = ''
            this.closing = false
          } else if (c === "'" || c === '"') {
            this.mode = 'quoted'
            this.quote = c
            this.acc = ''
            this.escaped = false
            this.closing = false
          } else if (isDigit(c)) {
            this.mode = 'number'
            this.acc = c
            this.expSign = false
          } else if (isWordStart(c)) {
            this.mode = 'word'
            this.acc = c
          } else out.push({ kind: 'punct', text: c })
          break
        }
        case 'dash': {
          // mysqldump always writes `-- `; a lone `-` is the arithmetic operator.
          if (c === '-') {
            this.mode = 'lineComment'
            i += 1
          } else {
            out.push({ kind: 'punct', text: '-' })
            this.mode = 'top'
          }
          break
        }
        case 'slash': {
          if (c === '*') {
            this.mode = 'blockComment'
            this.star = false
            i += 1
          } else {
            out.push({ kind: 'punct', text: '/' })
            this.mode = 'top'
          }
          break
        }
        case 'lineComment': {
          i += 1
          if (c === '\n') this.mode = 'top'
          break
        }
        case 'blockComment': {
          // `/*!40101 … */` conditional comments are dropped whole, contents included.
          i += 1
          if (this.star && c === '/') {
            this.mode = 'top'
            this.star = false
          } else this.star = c === '*'
          break
        }
        case 'word': {
          if (isWordChar(c)) {
            let j = i
            while (j < n && isWordChar(text[j] as string)) j += 1
            this.acc += text.slice(i, j)
            i = j
          } else {
            out.push({ kind: 'word', text: this.acc })
            this.acc = ''
            this.mode = 'top'
          }
          break
        }
        case 'number': {
          if (this.acc === '0' && (c === 'x' || c === 'X')) {
            this.mode = 'hex'
            this.acc = ''
            i += 1
          } else if (isDigit(c) || c === '.') {
            this.acc += c
            this.expSign = false
            i += 1
          } else if (
            (c === 'e' || c === 'E') &&
            !this.acc.includes('e') &&
            !this.acc.includes('E')
          ) {
            this.acc += c
            this.expSign = true
            i += 1
          } else if (this.expSign && (c === '+' || c === '-')) {
            this.acc += c
            this.expSign = false
            i += 1
          } else {
            out.push({ kind: 'number', text: this.acc })
            this.acc = ''
            this.mode = 'top'
          }
          break
        }
        case 'hex': {
          if (isHexDigit(c)) {
            let j = i
            while (j < n && isHexDigit(text[j] as string)) j += 1
            this.acc += text.slice(i, j)
            i = j
          } else {
            out.push({ kind: 'hex', text: this.acc })
            this.acc = ''
            this.mode = 'top'
          }
          break
        }
        case 'ident': {
          if (this.closing) {
            if (c === '`') {
              this.acc += '`'
              this.closing = false
              i += 1
            } else {
              out.push({ kind: 'ident', text: this.acc })
              this.acc = ''
              this.mode = 'top'
            }
          } else if (c === '`') {
            this.closing = true
            i += 1
          } else {
            let j = i
            while (j < n && text[j] !== '`') j += 1
            this.acc += text.slice(i, j)
            i = j
          }
          break
        }
        case 'quoted': {
          if (this.escaped) {
            this.acc += ESCAPES[c] ?? c
            this.escaped = false
            i += 1
          } else if (this.closing) {
            if (c === this.quote) {
              // A doubled quote inside the literal, the SQL-standard escape.
              this.acc += this.quote
              this.closing = false
              i += 1
            } else {
              out.push({ kind: 'string', text: this.acc })
              this.acc = ''
              this.mode = 'top'
            }
          } else if (c === '\\') {
            this.escaped = true
            i += 1
          } else if (c === this.quote) {
            this.closing = true
            i += 1
          } else {
            let j = i
            while (j < n) {
              const d = text[j] as string
              if (d === '\\' || d === this.quote) break
              j += 1
            }
            this.acc += text.slice(i, j)
            i = j
          }
          break
        }
      }
    }
  }

  /** Flush the token in progress at end of input. */
  finish(out: SqlToken[]): void {
    switch (this.mode) {
      case 'word':
        out.push({ kind: 'word', text: this.acc })
        break
      case 'number':
        out.push({ kind: 'number', text: this.acc })
        break
      case 'hex':
        out.push({ kind: 'hex', text: this.acc })
        break
      case 'ident':
        out.push({ kind: 'ident', text: this.acc })
        break
      case 'quoted':
        // Only reachable on a truncated dump; keep what was read rather than throwing.
        out.push({ kind: 'string', text: this.acc })
        break
      case 'dash':
        out.push({ kind: 'punct', text: '-' })
        break
      case 'slash':
        out.push({ kind: 'punct', text: '/' })
        break
      default:
        break
    }
    this.acc = ''
    this.mode = 'top'
    this.closing = false
    this.escaped = false
  }
}

// ---------------------------------------------------------------------------
// Statement parser
// ---------------------------------------------------------------------------

const hexToBytes = (hex: string): Uint8Array => {
  const padded = hex.length % 2 === 0 ? hex : `0${hex}`
  const out = new Uint8Array(padded.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** Words that open a table constraint rather than a column definition. */
const CONSTRAINT_WORDS = new Set([
  'PRIMARY',
  'UNIQUE',
  'KEY',
  'INDEX',
  'FULLTEXT',
  'SPATIAL',
  'CONSTRAINT',
  'FOREIGN',
  'CHECK',
  'PERIOD',
])

const upperOf = (token: SqlToken | undefined): string =>
  token === undefined ? '' : token.text.toUpperCase()

const tableName = (token: SqlToken | undefined): string =>
  token === undefined ? '' : token.text.toLowerCase()

/** `(…)`-delimited value tokens → one literal. */
const toLiteral = (tokens: readonly SqlToken[]): SqlLiteral => {
  const first = tokens[0]
  if (first === undefined) return { type: 'word', value: '' }

  if (tokens.length === 1) {
    switch (first.kind) {
      case 'string':
        return { type: 'string', value: first.text }
      case 'number':
        return { type: 'number', value: first.text }
      case 'hex':
        return { type: 'binary', value: hexToBytes(first.text) }
      case 'word':
        return first.text.toUpperCase() === 'NULL'
          ? { type: 'null' }
          : { type: 'word', value: first.text }
      default:
        return { type: 'word', value: first.text }
    }
  }

  const second = tokens[1]
  if (second !== undefined && tokens.length === 2) {
    // A signed number: mysqldump writes `-1` as two tokens.
    if (first.kind === 'punct' && (first.text === '-' || first.text === '+')) {
      if (second.kind === 'number')
        return { type: 'number', value: first.text === '-' ? `-${second.text}` : second.text }
    }
    if (first.kind === 'word' && second.kind === 'string') {
      const marker = first.text.toUpperCase()
      // X'4d79…' / x'…' — a hex literal in its other spelling.
      if (marker === 'X') return { type: 'binary', value: hexToBytes(second.text) }
      // b'0101' — a bit literal.
      if (marker === 'B') {
        const n = Number.parseInt(second.text, 2)
        return { type: 'number', value: Number.isNaN(n) ? '0' : String(n) }
      }
      // `_binary '…'` — mysqldump's marker for a column it dumped as bytes.
      if (marker === '_BINARY') return { type: 'binary', value: encoder.encode(second.text) }
      // Any other charset introducer (`_utf8mb4 '…'`, `N'…'`) is just the string.
      return { type: 'string', value: second.text }
    }
  }
  return { type: 'word', value: tokens.map((t) => t.text).join(' ') }
}

/** The table a `CREATE TABLE …` head names: the identifier just before the definition. */
const createTableName = (head: readonly SqlToken[], openAt: number): string => {
  const before = head[openAt - 1]
  if (before === undefined) return ''
  if (before.kind === 'ident' || before.kind === 'word') return tableName(before)
  return ''
}

const parseCreateTable = (head: readonly SqlToken[]): SqlCreateTableEvent | null => {
  const openAt = head.findIndex((t) => t.kind === 'punct' && t.text === '(')
  if (openAt < 0) return null
  const table = createTableName(head, openAt)
  if (table === '') return null

  const columns: string[] = []
  let depth = 1
  let atDefinitionStart = true
  for (let i = openAt + 1; i < head.length; i += 1) {
    const tok = head[i] as SqlToken
    if (tok.kind === 'punct') {
      if (tok.text === '(') depth += 1
      else if (tok.text === ')') {
        depth -= 1
        if (depth === 0) break
      } else if (tok.text === ',' && depth === 1) {
        atDefinitionStart = true
        continue
      }
      continue
    }
    if (!atDefinitionStart || depth !== 1) continue
    atDefinitionStart = false
    if (tok.kind === 'ident') columns.push(tok.text)
    else if (tok.kind === 'word' && !CONSTRAINT_WORDS.has(tok.text.toUpperCase()))
      columns.push(tok.text)
  }
  return columns.length === 0 ? null : { kind: 'create-table', table, columns }
}

interface InsertHead {
  table: string
  columns: readonly string[] | null
}

/** `INSERT [LOW_PRIORITY|IGNORE] INTO \`t\` [(\`a\`,\`b\`)] VALUES` → table and column list. */
const parseInsertHead = (head: readonly SqlToken[]): InsertHead | null => {
  const intoAt = head.findIndex((t) => t.kind === 'word' && t.text.toUpperCase() === 'INTO')
  if (intoAt < 0) return null
  let at = intoAt + 1
  let name = head[at]
  if (name === undefined) return null
  // `db`.`table`
  const dot = head[at + 1]
  if (dot !== undefined && dot.kind === 'punct' && dot.text === '.') {
    at += 2
    name = head[at]
    if (name === undefined) return null
  }
  const table = tableName(name)
  if (table === '') return null

  const open = head[at + 1]
  if (open === undefined || open.kind !== 'punct' || open.text !== '(')
    return { table, columns: null }

  const columns: string[] = []
  for (let i = at + 2; i < head.length; i += 1) {
    const tok = head[i] as SqlToken
    if (tok.kind === 'punct') {
      if (tok.text === ')') break
      continue
    }
    if (tok.kind === 'ident' || tok.kind === 'word') columns.push(tok.text)
  }
  return { table, columns }
}

export interface SqlDumpParserOptions {
  /**
   * Return false to drop a table's statements without materialising any row. The dump is
   * still tokenised — that is what finds the statement's end — but nothing is retained.
   */
  wantTable?: (table: string) => boolean
  /** Abandon a statement whose head grows past this many tokens. Guards a hostile file. */
  maxHeadTokens?: number
  /** Cap on the tokens one value may span; a longer expression is truncated, not buffered. */
  maxValueTokens?: number
}

type ParseMode = 'head' | 'skip' | 'values' | 'row'

/**
 * Feed it dump text, take {@link SqlDumpEvent}s out. Statements that are neither
 * `CREATE TABLE` nor an `INSERT … VALUES` — `SET`, `LOCK TABLES`, `UNLOCK TABLES`,
 * `DROP TABLE`, `ALTER TABLE`, `USE` — are discarded token by token as they stream past.
 */
export class SqlDumpParser {
  private readonly lexer = new SqlLexer()
  private readonly wantTable: (table: string) => boolean
  private readonly maxHeadTokens: number
  private readonly maxValueTokens: number

  private mode: ParseMode = 'head'
  private head: SqlToken[] = []
  private depth = 0
  private table = ''
  private columns: readonly string[] | null = null
  private wanted = true
  private rowValues: SqlLiteral[] = []
  private value: SqlToken[] = []
  private rowDepth = 0

  constructor(options: SqlDumpParserOptions = {}) {
    this.wantTable = options.wantTable ?? (() => true)
    this.maxHeadTokens = options.maxHeadTokens ?? 50_000
    this.maxValueTokens = options.maxValueTokens ?? 64
  }

  /** Consume the next slice of the dump. Returns the events it completed. */
  push(text: string): SqlDumpEvent[] {
    const tokens: SqlToken[] = []
    this.lexer.feed(text, tokens)
    return this.consume(tokens)
  }

  /** Flush at end of input: a dump missing its final `;` still yields its last row. */
  end(): SqlDumpEvent[] {
    const tokens: SqlToken[] = []
    this.lexer.finish(tokens)
    const out = this.consume(tokens)
    if (this.mode === 'head' && this.head.length > 0 && upperOf(this.head[0]) === 'CREATE') {
      const event = parseCreateTable(this.head)
      if (event && this.wantTable(event.table)) out.push(event)
    }
    this.reset()
    return out
  }

  private consume(tokens: readonly SqlToken[]): SqlDumpEvent[] {
    const out: SqlDumpEvent[] = []
    for (const token of tokens) this.step(token, out)
    return out
  }

  private reset(): void {
    this.mode = 'head'
    this.head = []
    this.depth = 0
    this.table = ''
    this.columns = null
    this.wanted = true
    this.rowValues = []
    this.value = []
    this.rowDepth = 0
  }

  private step(token: SqlToken, out: SqlDumpEvent[]): void {
    switch (this.mode) {
      case 'skip':
        if (token.kind === 'punct' && token.text === ';') this.reset()
        return
      case 'head':
        this.stepHead(token, out)
        return
      case 'values':
        this.stepValues(token)
        return
      case 'row':
        this.stepRow(token, out)
        return
    }
  }

  private stepHead(token: SqlToken, out: SqlDumpEvent[]): void {
    if (token.kind === 'punct' && token.text === ';') {
      if (this.head.length > 0 && upperOf(this.head[0]) === 'CREATE') {
        const event = parseCreateTable(this.head)
        if (event) out.push(event)
      }
      this.reset()
      return
    }

    if (this.head.length === 0) {
      const keyword = token.kind === 'word' ? token.text.toUpperCase() : ''
      if (keyword !== 'INSERT' && keyword !== 'REPLACE' && keyword !== 'CREATE') {
        this.mode = 'skip'
        return
      }
    }

    this.head.push(token)
    if (this.head.length > this.maxHeadTokens) {
      this.head = []
      this.mode = 'skip'
      return
    }
    if (token.kind === 'punct') {
      if (token.text === '(') this.depth += 1
      else if (token.text === ')') this.depth -= 1
    }

    if (upperOf(this.head[0]) === 'CREATE') {
      // As soon as the definition opens the table is known; drop it early if unwanted.
      if (token.kind === 'punct' && token.text === '(' && this.depth === 1) {
        const table = createTableName(this.head, this.head.length - 1)
        if (table === '' || !this.wantTable(table)) {
          this.head = []
          this.mode = 'skip'
        }
      }
      return
    }

    if (token.kind === 'word' && this.depth === 0) {
      const keyword = token.text.toUpperCase()
      if (keyword === 'VALUES' || keyword === 'VALUE') {
        const parsed = parseInsertHead(this.head)
        this.head = []
        if (parsed === null) {
          this.mode = 'skip'
          return
        }
        this.table = parsed.table
        this.columns = parsed.columns
        this.wanted = this.wantTable(parsed.table)
        // An unwanted table still has to be read to its `;`, but nothing is kept.
        this.mode = this.wanted ? 'values' : 'skip'
      } else if (keyword === 'SELECT' || keyword === 'SET') {
        // `INSERT … SELECT` / `INSERT … SET` carry no literal tuples.
        this.mode = 'skip'
      }
    }
  }

  private stepValues(token: SqlToken): void {
    if (token.kind === 'punct') {
      if (token.text === '(') {
        this.rowValues = []
        this.value = []
        this.rowDepth = 1
        this.mode = 'row'
        return
      }
      if (token.text === ',') return
      if (token.text === ';') {
        this.reset()
        return
      }
    }
    // `ON DUPLICATE KEY UPDATE …` and anything else trailing the tuples.
    this.mode = 'skip'
  }

  private stepRow(token: SqlToken, out: SqlDumpEvent[]): void {
    if (token.kind === 'punct') {
      if (token.text === '(') {
        this.rowDepth += 1
        this.pushValueToken(token)
        return
      }
      if (token.text === ')') {
        this.rowDepth -= 1
        if (this.rowDepth === 0) {
          this.rowValues.push(toLiteral(this.value))
          this.value = []
          out.push({
            kind: 'insert-row',
            table: this.table,
            columns: this.columns,
            values: this.rowValues,
          })
          this.rowValues = []
          this.mode = 'values'
          return
        }
        this.pushValueToken(token)
        return
      }
      if (token.text === ',' && this.rowDepth === 1) {
        this.rowValues.push(toLiteral(this.value))
        this.value = []
        return
      }
    }
    this.pushValueToken(token)
  }

  private pushValueToken(token: SqlToken): void {
    if (this.value.length >= this.maxValueTokens) return
    this.value.push(token)
  }
}

/**
 * The streaming form: decode chunks (UTF-8, multi-byte sequences may straddle a chunk) and
 * yield events as they complete. Chunks may be bytes or text; a reader should not mix them.
 */
export async function* parseSqlDump(
  chunks: AsyncIterable<Uint8Array | string>,
  options: SqlDumpParserOptions = {},
): AsyncIterable<SqlDumpEvent> {
  const parser = new SqlDumpParser(options)
  const streaming = new TextDecoder('utf-8')
  for await (const chunk of chunks) {
    const text = typeof chunk === 'string' ? chunk : streaming.decode(chunk, { stream: true })
    if (text === '') continue
    for (const event of parser.push(text)) yield event
  }
  const tail = streaming.decode()
  if (tail !== '') for (const event of parser.push(tail)) yield event
  for (const event of parser.end()) yield event
}
