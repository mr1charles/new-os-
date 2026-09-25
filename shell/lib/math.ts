/**
 * Safe calculator for the launcher ("15% of 84", "sqrt(2)*3", "2^10"). A small recursive
 * descent parser, never `eval`.
 *
 * Grammar (lowest to highest precedence):
 *   expr    := term (("+" | "-") term)*
 *   term    := unary (("*" | "/" | "of" | "mod") unary)*
 *   unary   := ("-" | "+") unary | power
 *   power   := postfix ("^" unary)?          right associative
 *   postfix := primary ("%" | "!")*
 *   primary := number | constant | func "(" expr ")" | "(" expr ")"
 */

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
}

type Token =
  { type: "num"; value: number } | { type: "id"; value: string } | { type: "op"; value: string }

export function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  const src = input
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/,(?=\d{3}\b)/g, "")
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (/[0-9.]/.test(ch)) {
      const match = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i))
      if (!match) return null
      tokens.push({ type: "num", value: Number(match[0]) })
      i += match[0].length
      continue
    }
    if (/[a-zπ]/i.test(ch)) {
      const match = /^[a-zπ][a-z0-9]*/i.exec(src.slice(i))!
      tokens.push({ type: "id", value: match[0].toLowerCase() })
      i += match[0].length
      continue
    }
    if ("+-*/^%()!".includes(ch)) {
      tokens.push({ type: "op", value: ch })
      i++
      continue
    }
    return null
  }
  return tokens
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN
  let result = 1
  for (let k = 2; k <= n; k++) result *= k
  return result
}

class Parser {
  #pos = 0
  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const value = this.expr()
    if (this.#pos !== this.tokens.length) throw new Error("unexpected input")
    return value
  }

  #peek(): Token | undefined {
    return this.tokens[this.#pos]
  }

  #isOp(value: string): boolean {
    const t = this.#peek()
    return t?.type === "op" && t.value === value
  }

  #isId(value: string): boolean {
    const t = this.#peek()
    return t?.type === "id" && t.value === value
  }

  expr(): number {
    let value = this.term()
    while (this.#isOp("+") || this.#isOp("-")) {
      const op = (this.tokens[this.#pos++] as { value: string }).value
      const rhs = this.term()
      value = op === "+" ? value + rhs : value - rhs
    }
    return value
  }

  term(): number {
    let value = this.unary()
    for (;;) {
      if (this.#isOp("*") || this.#isId("of")) {
        this.#pos++
        value *= this.unary()
      } else if (this.#isOp("/")) {
        this.#pos++
        value /= this.unary()
      } else if (this.#isId("mod")) {
        this.#pos++
        value %= this.unary()
      } else {
        return value
      }
    }
  }

  unary(): number {
    if (this.#isOp("-")) {
      this.#pos++
      return -this.unary()
    }
    if (this.#isOp("+")) {
      this.#pos++
      return this.unary()
    }
    return this.power()
  }

  power(): number {
    const base = this.postfix()
    if (this.#isOp("^")) {
      this.#pos++
      return Math.pow(base, this.unary())
    }
    return base
  }

  postfix(): number {
    let value = this.primary()
    for (;;) {
      if (this.#isOp("%")) {
        this.#pos++
        value /= 100
      } else if (this.#isOp("!")) {
        this.#pos++
        value = factorial(value)
      } else {
        return value
      }
    }
  }

  primary(): number {
    const token = this.tokens[this.#pos++]
    if (!token) throw new Error("unexpected end")
    if (token.type === "num") return token.value
    if (token.type === "op" && token.value === "(") {
      const value = this.expr()
      if (!this.#isOp(")")) throw new Error("missing )")
      this.#pos++
      return value
    }
    if (token.type === "id") {
      const fn = FUNCTIONS[token.value]
      if (fn) {
        if (!this.#isOp("(")) throw new Error("expected (")
        this.#pos++
        const arg = this.expr()
        if (!this.#isOp(")")) throw new Error("missing )")
        this.#pos++
        return fn(arg)
      }
      const constant = CONSTANTS[token.value]
      if (constant !== undefined) return constant
    }
    throw new Error(`unexpected ${token.value}`)
  }
}

/** Evaluate an expression. Returns null for anything that is not valid, finite math. */
export function evaluate(input: string): number | null {
  const tokens = tokenize(input.trim().replace(/=\s*$/, ""))
  if (!tokens || tokens.length === 0) return null
  try {
    const value = new Parser(tokens).parse()
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/** True when the query is worth trying as math: has a digit or constant and an operator/function. */
export function looksLikeMath(input: string): boolean {
  const q = input.trim().toLowerCase()
  if (q.length === 0) return false
  if (/^[\d.]+$/.test(q)) return false
  const hasNumber = /\d|\bpi\b|π/.test(q)
  const hasOperator = /[+\-*/^%×÷!]|\bof\b|\bmod\b/.test(q)
  const hasFunction = new RegExp(`\\b(${Object.keys(FUNCTIONS).join("|")})\\s*\\(`).test(q)
  return hasNumber && (hasOperator || hasFunction)
}

/** Format a result without float noise: 0.1+0.2 -> "0.3", 1e21 -> "1e+21". */
export function formatNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return value.toLocaleString("en-US")
  const rounded = Number.parseFloat(value.toPrecision(12))
  if (Math.abs(rounded) >= 1e15 || (Math.abs(rounded) < 1e-6 && rounded !== 0)) {
    return rounded.toExponential(6).replace(/\.?0+e/, "e")
  }
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 10 })
}
