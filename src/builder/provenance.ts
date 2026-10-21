// src/builder/provenance.ts
// MDH provenance for the Builder: the popup's matching-provenance LOGIC (src/popup/
// mdh-provenance.ts — config extraction, typed placeholder values, row scoping, condition
// evaluation and the query-cascade replay), fed from the Builder's annotation and schema.
// This module only prepares the inputs; the replay itself is replayConfig, unchanged.
import {
  extractConfigsFromHook,
  flattenContent,
  buildSchemaTypes,
  mergeSchemaTypes,
  rowScopeForConfig,
  valuesForRow,
} from '../popup/mdh-provenance.js';
import { mdhHooks } from './matching.js';

export type ProvenanceInputs = ReturnType<typeof flattenContent>;

/** The annotation's values, typed by the schema (authoritative) over the content's hints. */
export function provenanceInputs(content: any[], schemaContent: any[]): ProvenanceInputs {
  const flat = flattenContent(content);
  return { ...flat, types: mergeSchemaTypes(flat.types, buildSchemaTypes(schemaContent)) };
}

/** Every configuration of the queue's MDH hooks, numbered within its hook. */
export function provenanceConfigs(hooks: any[]): { hook: any; index: number; cfg: any }[] {
  return mdhHooks(hooks).flatMap((hook) =>
    extractConfigsFromHook(hook).map((cfg, index) => ({ hook, index, cfg })),
  );
}

/** The values a configuration replays with: header values, or the chosen row of its table. */
export function configValues(cfg: any, inputs: ProvenanceInputs, row: number) {
  const scope = rowScopeForConfig(cfg, inputs.tables);
  const values = scope
    ? valuesForRow(
        inputs.headerValues,
        inputs.rowValues,
        Math.min(row, Math.max(0, scope.rowCount - 1)),
      )
    : inputs.headerValues;
  return { scope, values };
}
