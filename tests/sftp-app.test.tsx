// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import App from '../src/sftp/components/App.jsx';
import Servers from '../src/sftp/components/Servers.jsx';
import Browser from '../src/sftp/components/Browser.jsx';
import Modal from '../src/ui/Modal.jsx';
import { createBody, serverFromHook, type Server } from '../src/sftp/servers.js';
import type { Invocation } from '../src/sftp/api.js';
import { bytesToBase64 } from '../src/sftp/preview.js';

const NOW = new Date(2026, 10, 19, 15, 0);
const ts = (daysAgo: number) => new Date(2026, 10, 19 - daysAgo, 9, 30).getTime() / 1000;

function server(id = 7, settings: Record<string, any> = {}): Server {
  const body = createBody({
    host: 'sftp.example.com',
    port: 22,
    user: 'acme',
    auth: 'password',
    secret: 'x',
  });
  return serverFromHook({
    ...body,
    id,
    url: `https://example.rossum.app/api/v1/hooks/${id}`,
    settings: { ...body.settings, ...settings },
  })!;
}

let root: HTMLElement | null = null;
async function mount(node: any) {
  root = document.createElement('div');
  document.body.appendChild(root);
  await act(async () => {
    render(node, root!);
  });
  await act(async () => {});
  return root;
}
afterEach(() => {
  if (root) render(null, root);
  root?.remove();
  root = null;
});

const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('the server list', () => {
  it('lists the saved servers and opens one', async () => {
    const el = await mount(<App connected={true} listServers={async () => [server(7)]} />);
    expect(el.textContent).toContain('acme@sftp.example.com:22');
    expect(el.textContent).toContain('not opened yet');
  });

  it('says what to do with no servers', async () => {
    const el = await mount(<App connected={true} listServers={async () => []} />);
    expect(el.textContent).toContain('No servers yet');
  });

  it('asks for the Console from a Rossum page when not connected', async () => {
    const el = await mount(<App connected={false} listServers={async () => []} />);
    expect(el.textContent).toContain('Open the Console from a Rossum page');
  });

  it('adds a server with its password and opens it', async () => {
    const createServer = vi.fn(async (_input: any) => server(9));
    const onSaved = vi.fn();
    const el = await mount(
      <Servers
        servers={[]}
        loadError=""
        onRetry={() => {}}
        onOpen={() => {}}
        onSaved={onSaved}
        onRemoved={() => {}}
        createServer={createServer}
      />,
    );
    await act(async () => button(el, 'Add server').click());
    const inputs = [...el.querySelectorAll('input')] as HTMLInputElement[];
    const type = (i: HTMLInputElement, v: string) => {
      i.value = v;
      i.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => {
      type(inputs[0], 'sftp.example.com');
      type(inputs[2], 'acme');
      type(inputs[3], 'pw');
    });
    await act(async () => {
      el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }));
    });
    expect(createServer.mock.calls[0][0]).toEqual({
      host: 'sftp.example.com',
      port: 22,
      user: 'acme',
      auth: 'password',
      secret: 'pw',
    });
    expect(onSaved).toHaveBeenCalledWith(server(9), true);
  });
});

describe('browsing a server', () => {
  const listing = (entries: any[]): Invocation => ({
    hostKey: 'ssh-ed25519 SHA256:k',
    results: [{ ok: true, entries }],
  });

  it('lists the folder, pins the host key on the first open, and opens a subfolder', async () => {
    const invoke = vi.fn(async (_s: Server, ops: any[]) =>
      ops[0].path === '.'
        ? listing([
            { name: 'upload', size: 0, mtime: ts(0), dir: true },
            { name: 'a.csv', size: 10, mtime: ts(1), dir: false },
          ])
        : listing([{ name: 'b.csv', size: 20, mtime: ts(0), dir: false }]),
    );
    const pinned = server(7, { host_key: 'ssh-ed25519 SHA256:k' });
    const pinServer = vi.fn(async () => pinned);
    const onServer = vi.fn();
    const el = await mount(
      <Browser
        server={server(7)}
        onServer={onServer}
        invoke={invoke as any}
        pinServer={pinServer}
        now={() => NOW}
      />,
    );
    expect(el.textContent).toContain('a.csv');
    expect(el.textContent).toContain('Arrivals');
    expect(pinServer).toHaveBeenCalledWith(server(7), 'ssh-ed25519 SHA256:k');
    expect(onServer).toHaveBeenCalledWith(pinned);

    const row = [...el.querySelectorAll('tr')].find((r) => r.textContent?.includes('upload'))!;
    await act(async () => row.click());
    await act(async () => {});
    expect(invoke.mock.calls[1][1]).toEqual([{ op: 'list', path: 'upload', depth: 1 }]);
    expect(el.textContent).toContain('b.csv');
    expect(el.textContent).toContain('New today');
  });

  it('updates a stale helper before calling it, and shows the call while it runs', async () => {
    const stale = serverFromHook({
      ...server(7).raw,
      settings: { ...server(7).raw.settings, host_key: 'ssh-ed25519 SHA256:k' },
      config: { runtime: 'python3.12', code: '# old' },
    })!;
    const fresh = server(7, { host_key: 'ssh-ed25519 SHA256:k' });
    const order: string[] = [];
    let finish!: (v: Invocation) => void;
    const invoke = vi.fn((s: Server) => {
      order.push(`invoke stale=${s.stale}`);
      return new Promise<Invocation>((r) => (finish = r));
    });
    const pinServer = vi.fn(async () => {
      order.push('pin');
      return fresh;
    });
    const el = await mount(
      <Browser
        server={stale}
        onServer={() => {}}
        invoke={invoke as any}
        pinServer={pinServer}
        now={() => NOW}
      />,
    );
    expect(order).toEqual(['pin', 'invoke stale=false']);
    expect(el.querySelector('[role="status"]')!.textContent).toContain('Opening sftp.example.com');
    await act(async () => finish(listing([])));
    await act(async () => {});
    expect(el.querySelector('[role="status"]')).toBe(null);
    expect(el.textContent).toContain('This folder is empty');
  });

  it('renames a file through the dialog and lists the folder again', async () => {
    const invoke = vi.fn(async (_s: Server, ops: any[]) =>
      ops.length === 1
        ? listing([{ name: 'a.csv', size: 10, mtime: ts(0), dir: false }])
        : {
            hostKey: 'ssh-ed25519 SHA256:k',
            results: [
              { ok: true },
              { ok: true, entries: [{ name: 'b.csv', size: 10, mtime: ts(0), dir: false }] },
            ],
          },
    );
    const s = server(7, { host_key: 'ssh-ed25519 SHA256:k' });
    const el = await mount(
      <div>
        <Browser server={s} onServer={() => {}} invoke={invoke as any} now={() => NOW} />
        <Modal />
      </div>,
    );
    const row = [...el.querySelectorAll('tr')].find((r) => r.textContent?.includes('a.csv'))!;
    await act(async () => row.click());
    await act(async () => button(el, 'Rename or move').click());
    const input = [...document.querySelectorAll('input')].find((i) => i.value === 'a.csv')!;
    input.value = 'b.csv';
    await act(async () => button(document.body, 'Move').click());
    await act(async () => {});
    expect(invoke.mock.calls.at(-1)![1]).toEqual([
      { op: 'rename', path: 'a.csv', to: 'b.csv' },
      { op: 'list', path: '.', depth: 1 },
    ]);
    expect(el.textContent).toContain('Moved a.csv to b.csv');
  });

  it('opens a preloaded subfolder at once and refreshes it quietly', async () => {
    let finish!: (v: Invocation) => void;
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        hostKey: 'ssh-ed25519 SHA256:k',
        results: [
          {
            ok: true,
            entries: [{ name: 'upload', size: 0, mtime: ts(0), dir: true }],
            children: { upload: [{ name: 'cached.csv', size: 1, mtime: ts(0), dir: false }] },
          },
        ],
      })
      .mockImplementationOnce(() => new Promise<Invocation>((r) => (finish = r)));
    const s = server(7, { host_key: 'ssh-ed25519 SHA256:k' });
    const el = await mount(
      <Browser server={s} onServer={() => {}} invoke={invoke} now={() => NOW} />,
    );
    const row = [...el.querySelectorAll('tr')].find((r) => r.textContent?.includes('upload'))!;
    await act(async () => row.click());
    // Shown from the cache while the refresh is still running, with no overlay over it.
    expect(el.textContent).toContain('cached.csv');
    expect(el.querySelector('[role="status"]')!.textContent).toContain('Refreshing');
    expect(el.textContent).not.toContain('Opening upload');
    await act(async () =>
      finish(listing([{ name: 'fresh.csv', size: 1, mtime: ts(0), dir: false }])),
    );
    await act(async () => {});
    expect(el.textContent).toContain('fresh.csv');
    expect(el.textContent).not.toContain('cached.csv');
  });

  it('keeps the file the user picked while a cached folder was refreshing', async () => {
    let finish!: (v: Invocation) => void;
    const file = { name: 'scan.txt', size: 3, mtime: ts(0), dir: false };
    const invoke = vi.fn((_s: Server, ops: any[]) => {
      if (ops[0].op === 'download')
        return Promise.resolve({ hostKey: 'k', results: [{ ok: true, size: 3, data: 'YWJj' }] });
      if (ops[0].path === '.')
        return Promise.resolve({
          hostKey: 'k',
          results: [
            {
              ok: true,
              entries: [{ name: 'upload', size: 0, mtime: ts(0), dir: true }],
              children: { upload: [file] },
            },
          ],
        });
      return new Promise<Invocation>((r) => (finish = r));
    });
    const s = server(7, { host_key: 'k' });
    const el = await mount(
      <Browser server={s} onServer={() => {}} invoke={invoke as any} now={() => NOW} />,
    );
    const folder = [...el.querySelectorAll('tr')].find((r) => r.textContent?.includes('upload'))!;
    await act(async () => folder.click());
    // The cached listing is on screen and its refresh still running: pick the file.
    const row = [...el.querySelectorAll('tr')].find((r) => r.textContent?.includes('scan.txt'))!;
    await act(async () => row.click());
    expect(el.querySelector('aside')).not.toBe(null);
    await act(async () => finish(listing([file])));
    await act(async () => {});
    expect(el.querySelector('aside')).not.toBe(null);
  });

  it('downloads a large file in parts, joined in order', async () => {
    const MB = 1024 * 1024;
    const size = 7 * MB;
    const b64 = (n: number, fill: number) => bytesToBase64(new Uint8Array(n).fill(fill));
    const invoke = vi.fn(async (_s: Server, ops: any[]) => {
      if (ops[0].op === 'list')
        return listing([{ name: 'big.bin', size, mtime: ts(0), dir: false }]);
      const { offset, length } = ops[0];
      const n = Math.min(length, size - offset);
      return { hostKey: 'k', results: [{ ok: true, size, data: b64(n, offset / (3 * MB)) }] };
    });
    const saved: Blob[] = [];
    // jsdom has no object URLs; the download hands its Blob here.
    (URL as any).createObjectURL = (b: Blob) => (saved.push(b), 'blob:x');
    (URL as any).revokeObjectURL = () => {};
    const s = server(7, { host_key: 'k' });
    const el = await mount(
      <Browser server={s} onServer={() => {}} invoke={invoke as any} now={() => NOW} />,
    );
    const dl = el.querySelector('[aria-label="Download big.bin"]') as HTMLButtonElement;
    await act(async () => dl.click());
    for (let i = 0; i < 10 && !saved.length; i++) await act(async () => {});
    const parts = invoke.mock.calls.slice(1).map((c) => c[1][0]);
    expect(parts.map((p: any) => p.offset)).toEqual([0, 3 * MB, 6 * MB]);
    const bytes = new Uint8Array(await saved[0].arrayBuffer());
    expect(bytes.length).toBe(size);
    expect([bytes[0], bytes[3 * MB], bytes[size - 1]]).toEqual([0, 1, 2]);
  });

  it('draws an image whole in the preview, reading all of it', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
    const invoke = vi.fn(async (_s: Server, ops: any[]) =>
      ops[0].op === 'list'
        ? listing([{ name: 'scan.png', size: png.length, mtime: ts(0), dir: false }])
        : { hostKey: 'k', results: [{ ok: true, size: png.length, data: bytesToBase64(png) }] },
    );
    const made: Blob[] = [];
    (URL as any).createObjectURL = (b: Blob) => (made.push(b), 'blob:image');
    (URL as any).revokeObjectURL = () => {};
    const s = server(7, { host_key: 'k' });
    const el = await mount(
      <Browser server={s} onServer={() => {}} invoke={invoke as any} now={() => NOW} />,
    );
    const row = [...el.querySelectorAll('tr')].find((r) => r.textContent?.includes('scan.png'))!;
    await act(async () => row.click());
    for (let i = 0; i < 5 && !el.querySelector('img'); i++) await act(async () => {});
    // The whole file, not the text preview's first 512 KB.
    expect(invoke.mock.calls[1][1][0]).toMatchObject({
      op: 'download',
      offset: 0,
      length: 3 * 1024 * 1024,
    });
    expect(el.querySelector('img')!.getAttribute('src')).toBe('blob:image');
    expect(made[0].type).toBe('image/png');
    expect(el.textContent).not.toContain('binary file');
  });

  it('shows a PDF in the browser viewer, in a wider pane, with Open in a tab', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\n%\u00e2\n');
    const invoke = vi.fn(async (_s: Server, ops: any[]) =>
      ops[0].op === 'list'
        ? listing([{ name: 'INV-001.pdf', size: pdf.length, mtime: ts(0), dir: false }])
        : { hostKey: 'k', results: [{ ok: true, size: pdf.length, data: bytesToBase64(pdf) }] },
    );
    const made: Blob[] = [];
    (URL as any).createObjectURL = (b: Blob) => (made.push(b), 'blob:pdf');
    (URL as any).revokeObjectURL = () => {};
    const s = server(7, { host_key: 'k' });
    const el = await mount(
      <Browser server={s} onServer={() => {}} invoke={invoke as any} now={() => NOW} />,
    );
    const row = [...el.querySelectorAll('tr')].find((r) => r.textContent?.includes('INV-001'))!;
    await act(async () => row.click());
    for (let i = 0; i < 5 && !el.querySelector('iframe'); i++) await act(async () => {});
    expect(el.querySelector('iframe')!.getAttribute('src')).toBe('blob:pdf#navpanes=0&view=FitH');
    expect(made[0].type).toBe('application/pdf');
    const open = [...el.querySelectorAll('a')].find((a) => a.textContent === 'Open in a tab')!;
    expect(open.getAttribute('href')).toBe('blob:pdf');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(el.textContent).not.toContain('binary file');
  });

  it('stops on a changed host key until the user trusts the new one', async () => {
    const changed = Object.assign(new Error("The server's host key changed."), {
      hostKeyChanged: true,
      hostKey: 'ssh-ed25519 SHA256:new',
    });
    const invoke = vi.fn().mockRejectedValueOnce(changed).mockResolvedValue(listing([]));
    const pinServer = vi.fn(async (s: Server, _k: string | null) => s);
    const el = await mount(
      <Browser
        server={server(7, { host_key: 'ssh-ed25519 SHA256:old' })}
        onServer={() => {}}
        invoke={invoke}
        pinServer={pinServer}
        now={() => NOW}
      />,
    );
    expect(el.textContent).toContain('SHA256:old');
    expect(el.textContent).toContain('SHA256:new');
    await act(async () => button(el, 'Trust the new key').click());
    await act(async () => {});
    expect(pinServer.mock.calls[0][1]).toBe('ssh-ed25519 SHA256:new');
    expect(el.textContent).toContain('This folder is empty');
  });
});
