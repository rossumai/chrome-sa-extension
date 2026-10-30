// src/ui/lazyScript.ts
// A bundle nothing imports, loaded on first use by a same-package <script> (the extension
// page's CSP allows script-src 'self'). The bundle registers itself on `window`, and
// `registered` reads it back. Concurrent callers share one load; a failed load rejects them
// all but lets a later call retry.
export function lazyScript<T>(
  src: string,
  registered: () => T | null | undefined,
  name: string,
): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    const ready = registered();
    if (ready) return Promise.resolve(ready);
    if (pending) return pending;
    pending = new Promise<T>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        const loaded = registered();
        if (loaded) resolve(loaded);
        else reject(new Error(`${name} loaded but did not register`));
      };
      script.onerror = () => reject(new Error(`failed to load ${name}`));
      document.head.appendChild(script);
    });
    pending.catch(() => {
      pending = null;
    });
    return pending;
  };
}
