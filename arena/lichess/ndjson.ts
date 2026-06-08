// Parse a fetch Response body as NDJSON (newline-delimited JSON). Lichess
// streams emit one JSON object per line plus blank keep-alive lines; we buffer
// partial chunks and skip blanks. Works with both Node's async-iterable body
// (undici) and a spec ReadableStream (via a reader).
type ByteSource = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null;

function toAsyncIterable(body: ByteSource): AsyncIterable<Uint8Array> {
  if (!body) return (async function* () {})();
  if (Symbol.asyncIterator in (body as object)) return body as AsyncIterable<Uint8Array>;
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  return {
    async *[Symbol.asyncIterator]() {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

/** Yield one parsed JSON value per non-blank NDJSON line from `body`. */
export async function* parseNdjson<T = unknown>(body: ByteSource): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of toAsyncIterable(body)) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  const tail = buf.trim();
  if (tail) yield JSON.parse(tail) as T;
}
