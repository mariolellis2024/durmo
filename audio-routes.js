const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

function createAudioRouter(directory = path.join(__dirname, 'media/audio')) {
  const router = express.Router();
  const { tracks } = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  for (const track of tracks) {
    if (path.basename(track.file) !== track.file || !track.file.endsWith('.m4a')) {
      throw new Error('Nome inválido no catálogo de áudios.');
    }
    if (fs.statSync(path.join(directory, track.file)).size !== track.size) {
      throw new Error(`Áudio incompleto: ${track.id}. Execute npm run prepare:audio.`);
    }
  }

  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({
      tracks: tracks.map(({ id, title, duration, size, file }) => ({
        id, title, duration, size, url: `/api/audio/files/${file}`,
      })),
    });
  });

  router.get('/files/:file', (req, res, next) => {
    const track = tracks.find((item) => item.file === req.params.file);
    if (!track) return res.status(404).end();
    // sendFile streams byte ranges (206/416), HEAD and If-Range without
    // buffering the recording in Node. Versioned URLs make reuse safe.
    res.sendFile(track.file, {
      root: directory,
      acceptRanges: true,
      headers: {
        'Content-Type': 'audio/mp4',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    }, (error) => {
      if (error?.status === 416 && !res.headersSent) {
        res.set('Cache-Control', 'no-store');
        res.set('Content-Range', `bytes */${track.size}`);
        return res.status(416).end();
      }
      if (error && !req.aborted) next(error);
    });
  });
  return router;
}

module.exports = { createAudioRouter };
