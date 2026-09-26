import { assistant } from "@helixos/sdk"
import { formatNumber, type EvalOptions } from "@helixos/sdk/math"
import { useAppTheme } from "@helixos/sdk/react"
import { Button, cx, SegmentedControl, Select, Toolbar, Window } from "@helixos/ui"
import { History, Sparkles } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { answerLocally, expressionFromAssistant, type Answer } from "./engine"
import { convert, UNITS, type Category } from "./units"

type Mode = "basic" | "scientific" | "convert"

interface Entry extends Answer {
  input: string
}

const BASIC_KEYS = [
  ["C", "(", ")", "÷"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "−"],
  ["1", "2", "3", "+"],
  ["±", "0", ".", "="],
]
const SCIENTIFIC_KEYS = [
  ["sin", "cos", "tan", "π"],
  ["ln", "log", "√", "^"],
  ["x²", "!", "%", "ans"],
]
const OPERATORS = new Set(["÷", "×", "−", "+", "="])

/** What a key appends to the expression. */
const KEY_TEXT: Record<string, string> = {
  "÷": " / ",
  "×": " * ",
  "−": " - ",
  "+": " + ",
  sin: "sin(",
  cos: "cos(",
  tan: "tan(",
  ln: "ln(",
  log: "log(",
  "√": "sqrt(",
  "^": "^",
  "x²": "^2",
  π: "pi",
  ans: "ans",
}

function Keypad({ mode, onKey }: { mode: Mode; onKey: (key: string) => void }) {
  const rows = mode === "scientific" ? [...SCIENTIFIC_KEYS, ...BASIC_KEYS] : BASIC_KEYS
  return (
    <div className="calc-keypad" role="group" aria-label="Keypad">
      {rows.flat().map((key) => (
        <button
          key={key}
          type="button"
          className={cx(
            "calc-key",
            OPERATORS.has(key) && "calc-key--operator",
            key === "C" && "calc-key--function",
            SCIENTIFIC_KEYS.flat().includes(key) && "calc-key--scientific",
          )}
          onClick={() => onKey(key)}
        >
          {key}
        </button>
      ))}
    </div>
  )
}

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "length", label: "Length" },
  { value: "area", label: "Area" },
  { value: "volume", label: "Volume" },
  { value: "mass", label: "Weight" },
  { value: "temperature", label: "Temperature" },
  { value: "speed", label: "Speed" },
  { value: "time", label: "Time" },
  { value: "data", label: "Data" },
]

function Converter() {
  const [category, setCategory] = useState<Category>("length")
  const units = UNITS.filter((u) => u.category === category).map((u) => ({
    value: u.label,
    label: u.names[1] ?? u.label,
  }))
  const [from, setFrom] = useState(units[0]!.value)
  const [to, setTo] = useState(units[1]?.value ?? units[0]!.value)
  const [value, setValue] = useState("1")
  const pick = (next: Category) => {
    const list = UNITS.filter((u) => u.category === next)
    setCategory(next)
    setFrom(list[0]!.label)
    setTo(list[1]?.label ?? list[0]!.label)
  }
  const result = convert(Number(value.replace(/,/g, "")), from, to)
  return (
    <div className="calc-converter">
      <Select aria-label="Kind of unit" value={category} options={CATEGORIES} onChange={pick} />
      <div className="calc-convert-row">
        <input
          className="nx-textfield calc-convert-input"
          inputMode="decimal"
          aria-label="Value"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
        <Select aria-label="From unit" value={from} options={units} onChange={setFrom} />
      </div>
      <button
        type="button"
        className="calc-swap"
        aria-label="Swap units"
        onClick={() => (setFrom(to), setTo(from))}
      >
        ⇅
      </button>
      <div className="calc-convert-row">
        <output className="calc-convert-result" aria-live="polite">
          {result && Number.isFinite(result.result) ? formatNumber(result.result) : "—"}
        </output>
        <Select aria-label="To unit" value={to} options={units} onChange={setTo} />
      </div>
    </div>
  )
}

export function App() {
  useAppTheme()
  const [mode, setMode] = useState<Mode>("basic")
  const [angle, setAngle] = useState<"deg" | "rad">("deg")
  const [input, setInput] = useState("")
  const [history, setHistory] = useState<Entry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [asking, setAsking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // After "=", a new number starts a new calculation; an operator continues from the result.
  const [justEvaluated, setJustEvaluated] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  const ans = history[0]?.value
  const options = useMemo<EvalOptions>(() => {
    const variables: Record<string, number> = {}
    if (ans !== undefined) variables.ans = ans
    return { angle, variables }
  }, [angle, ans])
  const preview = useMemo(() => answerLocally(input, options), [input, options])
  const needsAssistant = !preview && /[a-z]{3,}/i.test(input) && !/^[a-z(]+\($/i.test(input.trim())

  useEffect(() => field.current?.focus(), [mode])

  const commit = (answer: Answer, typed: string) => {
    setHistory((h) => [{ ...answer, input: typed }, ...h].slice(0, 100))
    setInput(
      Number.isInteger(answer.value)
        ? String(answer.value)
        : String(Number(answer.value.toPrecision(12))),
    )
    setNotice(null)
    setJustEvaluated(true)
  }

  const ask = async () => {
    setAsking(true)
    setNotice(null)
    try {
      const reply = await assistant.complete("extract", input, { fields: ["expression"] })
      const expression = expressionFromAssistant(reply)
      const answer = expression ? answerLocally(expression, options) : null
      if (answer) commit(answer, input)
      else setNotice("The assistant couldn’t turn that into a calculation.")
    } catch {
      setNotice("The assistant isn’t available. Try a calculation like “15% tip on 84”.")
    } finally {
      setAsking(false)
    }
  }

  const equals = () => {
    if (preview) commit(preview, input)
    else if (needsAssistant) void ask()
  }

  const onKey = (key: string) => {
    field.current?.focus()
    if (key === "C") return setInput("")
    if (key === "=") return equals()
    if (key === "±")
      return setInput((s) =>
        s.startsWith("-(") && s.endsWith(")") ? s.slice(2, -1) : s ? `-(${s})` : "-",
      )
    const text = KEY_TEXT[key] ?? key
    const fresh =
      justEvaluated &&
      !OPERATORS.has(key) &&
      key !== "^" &&
      key !== "x²" &&
      key !== "!" &&
      key !== "%"
    setJustEvaluated(false)
    setInput((s) => (fresh ? text : s + text))
  }

  return (
    <Window>
      <Toolbar
        title=""
        actions={
          <>
            {mode === "scientific" && (
              <SegmentedControl
                label="Angle unit"
                value={angle}
                onChange={setAngle}
                options={[
                  { value: "deg", label: "Deg" },
                  { value: "rad", label: "Rad" },
                ]}
              />
            )}
            <SegmentedControl
              label="Mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "basic", label: "Basic" },
                { value: "scientific", label: "Scientific" },
                { value: "convert", label: "Convert" },
              ]}
            />
            <button
              type="button"
              className={cx("nx-icon-button", showHistory && "calc-active")}
              aria-label="History"
              aria-pressed={showHistory}
              title="History"
              onClick={() => setShowHistory((v) => !v)}
            >
              <History size={16} />
            </button>
          </>
        }
      />
      <div className="calc-body">
        <div className="calc-main">
          {mode === "convert" ? (
            <Converter />
          ) : (
            <>
              <div className="calc-display">
                <div className="calc-expression" aria-live="polite">
                  {preview?.expression && preview.expression !== input.trim()
                    ? preview.expression
                    : " "}
                </div>
                <input
                  ref={field}
                  className="calc-input"
                  aria-label="Calculation"
                  placeholder="0"
                  spellCheck={false}
                  autoComplete="off"
                  value={input}
                  onChange={(e) => {
                    const next = e.currentTarget.value
                    const typed = next.startsWith(input) ? next.slice(input.length) : null
                    setJustEvaluated(false)
                    // Typing a number or word right after "=" replaces the result.
                    setInput(justEvaluated && typed && /^[\w.(π√]/.test(typed) ? typed : next)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || (e.key === "=" && !e.shiftKey)) {
                      e.preventDefault()
                      equals()
                    } else if (e.key === "Escape") setInput("")
                  }}
                />
                <div className="calc-result" aria-live="polite">
                  {preview ? `= ${preview.text}` : needsAssistant ? "" : " "}
                  {needsAssistant && (
                    <Button size="small" disabled={asking} onClick={() => void ask()}>
                      <Sparkles size={12} /> {asking ? "Asking…" : "Ask Assistant"}
                    </Button>
                  )}
                </div>
                {notice && <div className="calc-notice">{notice}</div>}
              </div>
              <Keypad mode={mode} onKey={onKey} />
            </>
          )}
        </div>
        {showHistory && (
          <aside className="calc-history" aria-label="History">
            <div className="calc-history__head">
              <span>History</span>
              {history.length > 0 && (
                <Button variant="plain" size="small" onClick={() => setHistory([])}>
                  Clear
                </Button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="calc-history__empty">Results appear here.</p>
            ) : (
              history.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  className="calc-history__item"
                  onClick={() => setInput(String(h.value))}
                >
                  <span className="calc-history__input">{h.input}</span>
                  <span className="calc-history__value">{h.text}</span>
                </button>
              ))
            )}
          </aside>
        )}
      </div>
    </Window>
  )
}
