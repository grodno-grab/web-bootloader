import { useEffect, useState } from 'preact/hooks';
import { detectLang, translations, type Translations } from './i18n';
import { verifySignature } from './crypto';

const CONFIG_URL = import.meta.env.VITE_CONFIG_URL as string;

// VITE_PUBLIC_KEYS: one or more base64-encoded ML-DSA-65 public keys separated by "|"
const PUBLIC_KEYS = (import.meta.env.VITE_PUBLIC_KEYS as string || '')
  .split('|')
  .map((k) => k.trim())
  .filter(Boolean);

const CONFIG_TIMEOUT_MS = 30_000;
const INACTIVITY_MS = 30_000;
const MIN_LOADER_MS = 1_000;
const CIRCLE_R = 34;
const CIRCUMFERENCE = 2 * Math.PI * CIRCLE_R; // ≈ 213.6

// null = indeterminate (Content-Length unknown), number = 0..100
type State = { status: 'loading'; progress: number | null } | { status: 'error'; detail: string };

interface Config {
  url: string;
  contentSize?: number;
  urlSignatures: string[];
  contentSignatures: string[];
}

class NetworkError extends Error {
  constructor(cause: TypeError) {
    super(cause.message);
    this.name = 'NetworkError';
  }
}

async function safeFetch(
  url: string,
  opts: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, opts);
  } catch (e) {
    if (e instanceof TypeError) throw new NetworkError(e);
    throw e;
  }
}

async function loadAndVerify(
  t: Translations,
  onProgress: (p: number | null) => void,
): Promise<string> {
  if (PUBLIC_KEYS.length === 0) {
    throw new Error('No public keys configured (set VITE_PUBLIC_KEYS)');
  }

  // ── Config (small JSON, fixed timeout) ──────────────────────
  const configCtrl = new AbortController();
  const configTimer = setTimeout(() => configCtrl.abort(), CONFIG_TIMEOUT_MS);
  let config: Config;
  try {
    const configUrl = `${CONFIG_URL}?t=${Math.random().toString().slice(2)}`;
    const configRes = await safeFetch(configUrl, { cache: 'no-store', signal: configCtrl.signal });
    clearTimeout(configTimer);
    if (!configRes.ok) throw new Error(`Config fetch failed: HTTP ${configRes.status}`);
    config = await configRes.json();
  } catch (e) {
    clearTimeout(configTimer);
    if (e instanceof Error && e.name === 'AbortError') throw new Error(t.timeout);
    if (e instanceof NetworkError) throw new Error(`${t.networkError}: ${e.message}`);
    throw e;
  }

  if (
    !Array.isArray(config.urlSignatures) ||
    config.urlSignatures.length !== PUBLIC_KEYS.length ||
    !Array.isArray(config.contentSignatures) ||
    config.contentSignatures.length !== PUBLIC_KEYS.length
  ) {
    throw new Error('Signature count does not match key count');
  }

  if (!config.url.startsWith('https://')) {
    throw new Error('Page URL must use HTTPS');
  }

  const urlBytes = new TextEncoder().encode(config.url);
  for (let i = 0; i < PUBLIC_KEYS.length; i++) {
    if (!verifySignature(PUBLIC_KEYS[i], config.urlSignatures[i], urlBytes)) {
      throw new Error('URL signature verification failed');
    }
  }

  // ── Page (large file, inactivity timeout) ───────────────────
  const pageCtrl = new AbortController();
  let inactivityTimer: ReturnType<typeof setTimeout>;
  const resetInactivity = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => pageCtrl.abort(), INACTIVITY_MS);
  };

  const pageSize = config.contentSize ?? 0;
  onProgress(pageSize > 0 ? 0 : null);

  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    const pageRes = await safeFetch(config.url, { cache: 'no-store', signal: pageCtrl.signal });
    if (!pageRes.ok) throw new Error(`Page fetch failed: HTTP ${pageRes.status}`);

    resetInactivity();

    if (pageRes.body) {
      const reader = pageRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          resetInactivity();
          chunks.push(value);
          received += value.length;
          if (pageSize > 0) {
            onProgress(Math.min(100, Math.round((received / pageSize) * 100)));
          }
        }
      }
    } else {
      chunks.push(new TextEncoder().encode(await pageRes.text()));
    }
    clearTimeout(inactivityTimer!);
  } catch (e) {
    clearTimeout(inactivityTimer!);
    if (e instanceof Error && e.name === 'AbortError') throw new Error(t.timeout);
    if (e instanceof NetworkError) throw new Error(`${t.networkError}: ${e.message}`);
    throw e;
  }

  // Concatenate all chunks
  const totalBytes = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(totalBytes);
  let off = 0;
  for (const chunk of chunks) { buf.set(chunk, off); off += chunk.length; }

  // Decode then re-encode to match original signing process
  const html = new TextDecoder().decode(buf);
  const content = new TextEncoder().encode(html);

  for (let i = 0; i < PUBLIC_KEYS.length; i++) {
    if (!verifySignature(PUBLIC_KEYS[i], config.contentSignatures[i], content)) {
      throw new Error('Content signature verification failed');
    }
  }

  return html;
}

export function App() {
  const lang = detectLang();
  const t = translations[lang];

  const [state, setState] = useState<State>({ status: 'loading', progress: null });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = t.dir;
    document.title = t.loading;

    if (window.self !== window.top) {
      document.body.innerHTML = '';
      return;
    }

    const start = Date.now();
    let lastPct = -2;

    loadAndVerify(t, (progress) => {
      const pct = progress ?? -1;
      if (pct !== lastPct) {
        lastPct = pct;
        setState({ status: 'loading', progress });
      }
    })
      .then((html) => {
        const delay = MIN_LOADER_MS - (Date.now() - start);
        const show = () => { document.open(); document.write(html); document.close(); };
        if (delay > 0) setTimeout(show, delay); else show();
      })
      .catch((e: unknown) => {
        const delay = MIN_LOADER_MS - (Date.now() - start);
        const detail = e instanceof Error ? e.message : String(e);
        const show = () => setState({ status: 'error', detail });
        if (delay > 0) setTimeout(show, delay); else show();
      });
  }, []);

  if (state.status === 'loading') {
    const { progress } = state;
    const isIndeterminate = progress === null;
    const arc = isIndeterminate ? CIRCUMFERENCE * 0.25 : (progress / 100) * CIRCUMFERENCE;
    const dashArray = `${arc} ${CIRCUMFERENCE}`;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: 'Canvas',
          color: '#8E8E93',
          gap: '20px',
        }}
      >
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
        <svg
          width="80"
          height="80"
          viewBox="0 0 80 80"
          style={isIndeterminate ? { animation: 'spin 1s linear infinite' } : undefined}
        >
          {/* Track */}
          <circle
            cx="40"
            cy="40"
            r={CIRCLE_R}
            fill="none"
            stroke="currentColor"
            stroke-opacity="0.15"
            stroke-width="4"
          />
          {/* Progress arc */}
          <circle
            cx="40"
            cy="40"
            r={CIRCLE_R}
            fill="none"
            stroke="#2AABEE"
            stroke-width="4"
            stroke-linecap="round"
            stroke-dasharray={dashArray}
            stroke-dashoffset="0"
            transform="rotate(-90 40 40)"
          />
          {/* Percentage label */}
          {!isIndeterminate && (
            <text
              x="40"
              y="40"
              text-anchor="middle"
              dominant-baseline="central"
              fill="#8E8E93"
              font-size="16"
              font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
              font-weight="500"
            >
              {progress}%
            </text>
          )}
        </svg>
        <span style={{ fontSize: '15px', letterSpacing: '0.01em' }}>
          {t.loading}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        gap: '20px',
        background: '#b00020',
        color: '#fff',
        textAlign: 'center',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        boxSizing: 'border-box',
      }}
    >
      <h1
        style={{
          fontSize: 'clamp(20px, 5vw, 32px)',
          fontWeight: 700,
          lineHeight: 1.3,
          margin: 0,
        }}
      >
        {t.errorTitle}
      </h1>
      <p
        style={{
          fontSize: 'clamp(14px, 3vw, 18px)',
          maxWidth: '540px',
          opacity: 0.92,
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {t.errorDesc}
      </p>
      <p
        style={{
          fontSize: '13px',
          opacity: 0.7,
          fontFamily: 'monospace',
          wordBreak: 'break-all',
          maxWidth: '540px',
          margin: 0,
        }}
      >
        {state.detail}
      </p>
    </div>
  );
}
