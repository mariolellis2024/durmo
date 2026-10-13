const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { createAudioRouter } = require('../audio-routes');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'durmo-audio-test-'));
const bytes = Buffer.from(Array.from({ length: 8192 }, (_, index) => index % 251));
const filename = '01.test.m4a';
let server;
let base;
before(async () => {
  fs.writeFileSync(path.join(directory, filename), bytes);
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ tracks: [{
    id: '01', title: 'Áudio 01', duration: 1800, size: bytes.length, file: filename,
    originalSize: 100000, sha256: 'internal-build-metadata',
  }] }));
  const app = express();
  app.use('/api/audio', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.headers.cookie !== 'test-session=valid') return res.status(401).end();
    next();
  }, createAudioRouter(directory));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/audio`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});

const request = (url = `/files/${filename}`, options = {}) => fetch(base + url, {
  ...options, headers: { cookie: 'test-session=valid', ...options.headers },
});

test('catalogue exposes only playback data; requests require a session', async () => {
  const denied = await fetch(base + `/files/${filename}`, { headers: { range: 'bytes=0-10' } });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  const response = await request('');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { tracks: [{
    id: '01', title: 'Áudio 01', duration: 1800, size: 8192, url: `/api/audio/files/${filename}`,
  }] });
});

test('HEAD supplies media size and private immutable caching without a body', async () => {
  const response = await request(undefined, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mp4');
  assert.equal(response.headers.get('content-length'), '8192');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.match(response.headers.get('cache-control'), /^private,.*immutable/);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test('range requests return only the requested bytes, including seeks and suffixes', async () => {
  for (const [range, start, end] of [
    ['bytes=0-1', 0, 1], ['bytes=1024-2047', 1024, 2047],
    ['bytes=-100', 8092, 8191], ['bytes=8000-', 8000, 8191],
  ]) {
    const response = await request(undefined, { headers: { range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/8192`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1));
  }
});

test('out-of-bounds ranges are rejected; stale If-Range returns full representation', async () => {
  const invalid = await request(undefined, { headers: { range: 'bytes=9000-' } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), 'bytes */8192');
  await invalid.arrayBuffer();
  const stale = await request(undefined, { headers: { range: 'bytes=0-1', 'if-range': '"old-version"' } });
  assert.equal(stale.status, 200);
  assert.deepEqual(Buffer.from(await stale.arrayBuffer()), bytes);
});

test('only catalogued files can be streamed', async () => {
  for (const file of ['manifest.json', 'other.m4a', '..%2Fmanifest.json']) {
    const response = await request(`/files/${file}`);
    assert.equal(response.status, 404);
  }
});

test('client cancellation is quiet while file failures still reach error handling', { timeout: 10000 }, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'durmo-audio-abort-'));
  const file = path.join(folder, 'large.m4a');
  const fd = fs.openSync(file, 'w');
  fs.ftruncateSync(fd, 32 * 1024 * 1024);
  fs.closeSync(fd);
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ tracks: [{
    id: '01', file: 'large.m4a', size: fs.statSync(file).size,
  }] }));
  const failures = [];
  let complete;
  const transferEnded = new Promise((resolve) => { complete = resolve; });
  const app = express();
  app.use((req, res, next) => {
    const sendFile = res.sendFile;
    res.sendFile = function (name, options, callback) {
      if (req.headers['x-simulate-abort']) {
        assert.equal(Boolean(req.aborted), false);
        callback(Object.assign(new Error('Request aborted'), { code: 'ECONNABORTED' }));
        return res.end();
      }
      return sendFile.call(this, name, options, (error) => {
        callback(error);
        complete({ code: error?.code, requestAborted: req.aborted });
      });
    };
    next();
  });
  app.use(createAudioRouter(folder));
  app.use((error, _req, res, _next) => {
    failures.push(error);
    if (!res.destroyed) res.status(500).end();
  });
  const local = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const url = `http://127.0.0.1:${local.address().port}/files/large.m4a`;
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        res.once('data', () => { res.destroy(); resolve(); });
        res.on('error', reject);
      });
      req.on('error', reject);
    });
    const result = await transferEnded;
    assert.ok(['ECONNABORTED', 'ECONNRESET', 'EPIPE'].includes(result.code));
    assert.equal(failures.length, 0, failures.map((error) => error.stack).join('\n'));
    const cancelled = await fetch(url, { headers: { 'x-simulate-abort': '1' } });
    await cancelled.arrayBuffer();
    assert.equal(failures.length, 0, failures.map((error) => error.stack).join('\n'));
    fs.unlinkSync(file);
    const missing = await fetch(url);
    assert.equal(missing.status, 500);
    await missing.arrayBuffer();
    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, 'ENOENT');
  } finally {
    local.closeAllConnections();
    await new Promise((resolve) => local.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
