import http from 'node:http';

export class CallbackServer {
  async waitForCode(port) {
    console.log(`[CallbackServer.waitForCode] step 1: starting local HTTP listener on port ${port}`);
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        console.log('[CallbackServer.waitForCode] step 2: received redirect request to /callback?code=...&state=...');
        const url = new URL(req.url, `http://localhost:${port}`);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Authorization complete, you can close this window.</body></html>');
        console.log('[CallbackServer.waitForCode] step 3: resolving { code, state } and closing the listener');
        server.close();
        resolve({ code, state });
      });
      server.on('error', reject);
      server.listen(port);
    });
  }
}
