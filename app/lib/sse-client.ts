// Client-side SSE-over-fetch reader shared by the Quiz Builder's generate and
// copilot streams (EventSource can't POST with App Bridge session tokens, so
// both read the response body manually).
//
// Contract: parses `data: <json>` frames separated by blank lines, flushes
// the final buffered frame when the stream ends without a trailing separator,
// and skips malformed frames instead of aborting the read loop.

export async function readSseStream<T>(
  res: Response,
  onEvent: (event: T) => void,
): Promise<void> {
  if (!res.body) throw new Error("Response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleFrame = (frame: string) => {
    const line = frame.split("\n").find((l) => l.startsWith("data: "));
    if (!line) return;
    try {
      onEvent(JSON.parse(line.slice(6)) as T);
    } catch (e) {
      console.warn("[sse] skipping malformed frame:", e);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) handleFrame(frame);
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleFrame(buffer);
}
