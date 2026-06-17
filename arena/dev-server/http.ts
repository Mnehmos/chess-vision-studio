import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function readJsonBody<T>(req: IncomingMessage, maxBytes = 1_000_000): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (c) => {
      if (settled) return;
      body += c;
      if (body.length > maxBytes) fail(new Error('request body too large'));
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(body ? (JSON.parse(body) as T) : ({} as T));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', fail);
  });
}

export function npmCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function killProcessTree(child: ChildProcessWithoutNullStreams | null): void {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}
