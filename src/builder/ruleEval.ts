// src/builder/ruleEval.ts
// The open rule's trigger condition, evaluated on the picked annotation by the API endpoint
// Rossum's own rule editor uses for its preview: POST /v1/internal/rules/evaluate_rules.
// It is internal and undocumented; the shapes below are read off Rossum's web app (2026-10),
// which sends snake_case keys: { queue, annotation, annotation_content, schema_rules } and gets
// { condition_values: boolean[][] (per rule, then per evaluation), messages, actions }.
// The draft is sent without its id, so the unsaved condition is what runs.

import type { RuleDraft } from './ruleDraft.js';

export type RuleEval = {
  /** One result for a header rule; one per row when the condition reads a table column. */
  values: boolean[];
  /** Messages of type error: a condition or action the API could not evaluate. */
  errors: string[];
};

export function ruleEvalBody(
  draft: RuleDraft,
  queueUrl: string,
  annotationUrl: string,
  content: any[],
): Record<string, unknown> {
  return {
    queue: queueUrl,
    annotation: annotationUrl,
    annotation_content: content,
    schema_rules: [{ ...draft, queues: [queueUrl] }],
  };
}

/** The response is untyped on the wire; anything unexpected reads as no result. */
export function parseRuleEval(res: any): RuleEval {
  const first = Array.isArray(res?.condition_values) ? res.condition_values[0] : null;
  const values = Array.isArray(first) ? first.filter((v: unknown) => typeof v === 'boolean') : [];
  const errors = (Array.isArray(res?.messages) ? res.messages : [])
    .filter((m: any) => m?.type === 'error')
    .map((m: any) => String(m?.content ?? ''));
  return { values, errors };
}

/**
 * One line for the whole document: the result of a header rule, or (one result per table row)
 * whether it is true on any line, and on which.
 */
export function evalText(values: boolean[]): string {
  if (values.length <= 1) return values.length ? String(values[0]) : '';
  const on = values.flatMap((v, i) => (v ? [i + 1] : []));
  return on.length
    ? `true on line${on.length > 1 ? 's' : ''} ${on.join(', ')} of ${values.length}`
    : `false on all ${values.length} lines`;
}
