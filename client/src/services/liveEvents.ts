export type LiveEventHandler = (event: string, data: any) => void;

const parseSseBlock = (block: string) => {
  const lines = block.split('\n').map((line) => line.trimEnd());
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
      continue;
    }
  }
  const dataRaw = dataLines.join('\n');
  let data: any = dataRaw;
  try {
    data = dataRaw ? JSON.parse(dataRaw) : null;
  } catch {
  }
  return { event, data };
};

export function startLiveEvents(onEvent: LiveEventHandler) {
  let stopped = false;
  let abortController: AbortController | null = null;
  let retryMs = 800;

  const stop = () => {
    stopped = true;
    abortController?.abort();
  };

  const connect = async () => {
    if (stopped) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    abortController = new AbortController();
    try {
      const response = await fetch('/api/events', {
        headers: { Authorization: `Bearer ${token}` },
        signal: abortController.signal,
      });
      if (!response.ok) {
        throw new Error(`Live events failed: ${response.status}`);
      }
      if (!response.body) {
        throw new Error('Live events stream missing body');
      }
      retryMs = 800;

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const idx = buffer.indexOf('\n\n');
          if (idx === -1) break;
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const parsed = parseSseBlock(block);
          if (parsed.event) onEvent(parsed.event, parsed.data);
        }
      }
    } catch {
    } finally {
      abortController = null;
      if (stopped) return;
      const wait = retryMs;
      retryMs = Math.min(15000, Math.round(retryMs * 1.6));
      window.setTimeout(() => {
        void connect();
      }, wait);
    }
  };

  void connect();
  return stop;
}

