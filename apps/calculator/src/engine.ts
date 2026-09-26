/**
 * The Calculator's understanding of typed input: plain math (through the shared evaluator),
 * unit conversions, and everyday percentage phrases. Anything else can go to the assistant,
 * which only turns words into an expression; the arithmetic always happens here.
 */
import { evaluate, formatNumber, type EvalOptions } from "@helixos/sdk/math"
import { parseConversion } from "./units"

export interface Answer {
  /** What was computed, shown above the result ("15% tip on 84 → 84 × 0.15"). */
  expression: string
  value: number
  /** Display text, with units when it is a conversion. */
  text: string
}

const num = String.raw`(-?[\d.,]+)`
const n = (s: string) => Number(s.replace(/,/g, ""))

/** Rewrite everyday percentage phrases into math. Returns null when none matches. */
export function rewritePhrase(input: string): string | null {
  const q = input.trim().toLowerCase().replace(/\?$/, "")
  let m: RegExpExecArray | null
  // "15% tip on 84", "tip of 15% on 84", "20% tax on 50"
  if (
    (m = new RegExp(
      `^${num}\\s*%\\s*(?:tip|tax|interest|commission)?\\s*(?:on|of)\\s*\\$?${num}$`,
    ).exec(q))
  )
    return `${n(m[2]!)} * ${n(m[1]!)} / 100`
  if ((m = new RegExp(`^(?:tip|tax) of ${num}\\s*% on \\$?${num}$`).exec(q)))
    return `${n(m[2]!)} * ${n(m[1]!)} / 100`
  // "84 with a 15% tip", "84 plus 15%", "84 + 15%"
  if (
    (m = new RegExp(
      `^\\$?${num}\\s*(?:\\+|plus|with(?: a)?)\\s*${num}\\s*%(?:\\s*(?:tip|tax))?$`,
    ).exec(q))
  )
    return `${n(m[1]!)} * (1 + ${n(m[2]!)} / 100)`
  // "84 minus 20%", "84 - 20%", "20% off 84"
  if ((m = new RegExp(`^\\$?${num}\\s*(?:-|minus|less)\\s*${num}\\s*%$`).exec(q)))
    return `${n(m[1]!)} * (1 - ${n(m[2]!)} / 100)`
  if ((m = new RegExp(`^${num}\\s*%\\s*off\\s*\\$?${num}$`).exec(q)))
    return `${n(m[2]!)} * (1 - ${n(m[1]!)} / 100)`
  // "what percent of 80 is 20", "20 is what percent of 80"
  if ((m = new RegExp(`^what (?:percent|%) of ${num} is ${num}$`).exec(q)))
    return `${n(m[2]!)} / ${n(m[1]!)} * 100`
  if ((m = new RegExp(`^${num} is what (?:percent|%) of ${num}$`).exec(q)))
    return `${n(m[1]!)} / ${n(m[2]!)} * 100`
  // "split 84 between 3", "84 split 3 ways"
  if (
    (m = new RegExp(`^split \\$?${num} (?:between|among|by|in) ${num}(?: ways| people)?$`).exec(q))
  )
    return `${n(m[1]!)} / ${n(m[2]!)}`
  if ((m = new RegExp(`^\\$?${num} split ${num} ways$`).exec(q))) return `${n(m[1]!)} / ${n(m[2]!)}`
  return null
}

function prettyExpression(expression: string): string {
  return expression.replace(/\*/g, "×").replace(/\//g, "÷").replace(/\s+/g, " ").trim()
}

/** Answer typed input without the assistant, or null when it needs one. */
export function answerLocally(input: string, options: EvalOptions = {}): Answer | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const conversion = parseConversion(trimmed)
  if (conversion) {
    return {
      expression: `${formatNumber(conversion.value)} ${conversion.from} → ${conversion.to}`,
      value: conversion.result,
      text: `${formatNumber(conversion.result)} ${conversion.to}`,
    }
  }
  const phrase = rewritePhrase(trimmed)
  const expression = phrase ?? trimmed
  const value = evaluate(expression, options)
  if (value === null) return null
  return { expression: prettyExpression(expression), value, text: formatNumber(value) }
}

/**
 * The assistant's reply to an "extract" task with the field `expression`: a JSON object. Only
 * characters the evaluator understands are accepted, so the model can never smuggle in
 * anything but arithmetic.
 */
export function expressionFromAssistant(reply: string): string | null {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0]
  if (!json) return null
  try {
    const expression = (JSON.parse(json) as { expression?: unknown }).expression
    if (typeof expression !== "string") return null
    const clean = expression.trim()
    if (!clean || clean.length > 200 || !/^[\d\s.+\-*/^%()a-z,πe!]+$/i.test(clean)) return null
    return clean
  } catch {
    return null
  }
}
