// PES File Parser - Uses pyembroidery server (returns PNG directly)

class PESParser {
  static SERVER_URL = 'http://localhost:5000';

  // Parse PES and get PNG image from server
  static async parse(buffer, signal) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    // Check if already aborted
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // Convert to base64 (chunked to avoid stack overflow)
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    const base64 = btoa(binary);

    const response = await fetch(`${this.SERVER_URL}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileData: base64 }),
      signal: signal
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Server error');
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Parse failed');
    }

    return {
      thumbnail: result.thumbnail,  // 30% quality for grid
      preview: result.preview,      // 70% quality for zoom
      stitchCount: result.stitchCount,
      colorCount: result.colorCount,
      bounds: result.bounds,
      threads: result.threads || []
    };
  }

  // Check if server is running
  static async checkServer() {
    try {
      const response = await fetch(`${this.SERVER_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

window.PESParser = PESParser;
