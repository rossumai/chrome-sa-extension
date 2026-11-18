// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../src/mdh/api.js', () => ({ aggregate: vi.fn() }));
import { buildExportJob, getExportFormat } from '../src/mdh/exportFormats.jsx';
import { parseExportFilter } from '../src/mdh/pipelineOps.js';
import * as api from '../src/mdh/api.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('export wiring seam', () => {
  it('a parsed filter feeds buildExportJob end to end', async () => {
    const f = parseExportFilter('[{"$match":{"region":"EU"}}]', (t) => t);
    const job = buildExportJob(
      {
        scope: 'filtered',
        formatId: 'xlsx',
        opts: getExportFormat('xlsx')!.defaultOpts,
        columns: ['sku'],
        count: 5,
      },
      'vendors',
      f.stages,
    );
    expect(job.filename).toBe('vendors-filtered.xlsx');
    expect(job.pipelineStages).toEqual([{ $match: { region: 'EU' } }]);
    expect(job.serializer.binary).toBe(true);
    expect(await job.fetchCount()).toBe(5);
    expect(api.aggregate).not.toHaveBeenCalled();
  });
});
