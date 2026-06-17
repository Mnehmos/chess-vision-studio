import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { npmCommand, readJsonBody, sendJson } from './http';

function requestFromText(text: string): any {
  return Readable.from(text);
}

describe('dev server http helpers', () => {
  it('writes JSON responses with status and content type', () => {
    const headers = new Map<string, string>();
    const res = {
      statusCode: 0,
      body: '',
      setHeader: (name: string, value: string) => headers.set(name, value),
      end(payload: string) {
        this.body = payload;
      },
    } as any;

    sendJson(res, 202, { ok: true });

    expect(res.statusCode).toBe(202);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('parses JSON request bodies and defaults empty bodies to an object', async () => {
    await expect(readJsonBody<{ fen: string }>(requestFromText('{"fen":"startpos"}'))).resolves.toEqual({
      fen: 'startpos',
    });
    await expect(readJsonBody<Record<string, never>>(requestFromText(''))).resolves.toEqual({});
  });

  it('rejects invalid or oversized JSON request bodies', async () => {
    await expect(readJsonBody(requestFromText('{bad'))).rejects.toBeTruthy();
    await expect(readJsonBody(requestFromText('12345'), 3)).rejects.toThrow('request body too large');
  });

  it('selects the npm executable for the host platform', () => {
    expect(npmCommand('win32')).toBe('npm.cmd');
    expect(npmCommand('linux')).toBe('npm');
  });
});
