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
 * The result for one grid row: the only one for a header rule, the row's own when there is one
 * per table row. null when the results do not line up with this table's rows.
 */
export function evalForRow(values: boolean[], rows: number | null, row: number): boolean | null {
  if (values.length === 1) return values[0];
  if (rows != null && values.length === rows && row < rows) return values[row];
  return null;
}

export function evalSummary(values: boolean[]): string {
  if (values.length === 1) return String(values[0]);
  return `${values.filter(Boolean).length} of ${values.length} true`;
}
