const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

test('both loop assets have complete hashes, stereo, 30 min and metadata before media data', async () => {
  const root = path.join(__dirname, '../media/audio');
  const { tracks } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(tracks.length, 2);
  for (const track of tracks) {
    const file = path.join(root, track.file);
    assert.equal(fs.statSync(file).size, track.size);
    assert.equal(track.duration, 1800);
    assert.equal(track.channels, 2);
    assert.equal(track.crossfadeSeconds, 8);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    assert.equal(hash.digest('hex'), track.sha256);
    assert.ok(track.file.includes(track.sha256.slice(0, 16)));
    const fd = fs.openSync(file, 'r');
    const atoms = [];
    try {
      let offset = 0;
      while (offset < track.size) {
        const header = Buffer.alloc(8);
        assert.equal(fs.readSync(fd, header, 0, 8, offset), 8);
        const length = header.readUInt32BE();
        assert.ok(length >= 8);
        atoms.push(header.toString('ascii', 4, 8));
        offset += length;
      }
    } finally { fs.closeSync(fd); }
    assert.ok(atoms.includes('moov') && atoms.includes('mdat'));
    assert.ok(atoms.indexOf('moov') < atoms.indexOf('mdat'), 'faststart metadata must load first');
  }
});
