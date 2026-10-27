import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { envInputFor, ENV } from '../src/rdc/core.js';

// Loads the real rdc wasm in Node from the optional @mrtnzlml/rdc-wasm package. Skipped when
// it is not installed (no GitHub Packages token, CI included). No network: only create + read
// the tree.
const VENDOR = join(process.cwd(), 'node_modules', '@mrtnzlml', 'rdc-wasm');
const present = existsSync(join(VENDOR, 'rdc_wasm.js'));

describe.skipIf(!present)('rdc wasm package (Node)', () => {
  it('instantiates and creates an in-memory project for the connected env', async () => {
    const glue = await import(pathToFileURL(join(VENDOR, 'rdc_wasm.js')).href);
    glue.initSync({ module: readFileSync(join(VENDOR, 'rdc_wasm_bg.wasm')) });
    expect(glue.version()).toMatch(/^\d+\.\d+\.\d+/);
    const env = envInputFor(
      'https://acme.rossum.app',
      'tok',
      { results: [{ id: 42, name: 'Acme' }] },
      ENV,
    );
    if (typeof env === 'string') throw new Error(env);
    const project = glue.Project.create('console', env);
    const files: Map<string, Uint8Array> = project.files();
    expect(files.has('rdc.toml')).toBe(true);
    const toml = new TextDecoder().decode(files.get('rdc.toml'));
    expect(toml).toContain(`[envs.${ENV}]`);
    expect(toml).toContain('https://acme.rossum.app/api/v1');
    expect(toml).toContain('42');
    expect(typeof project.sync).toBe('function');
    project.free();
  });
});
