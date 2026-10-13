#!/usr/bin/env python3
"""Build stereo 30-minute loops with an 8-second baked crossfade. Keep originals."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
LOOP_SECONDS = 1800
FADE_SECONDS = 8


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries',
        'stream=codec_name,sample_rate,channels:format=duration,size',
        '-of', 'json', str(path),
    ]))


def prepare(track_id):
    source = ROOT / 'audios' / f'{track_id}.mp3'
    original = probe(source)
    assert float(original['format']['duration']) >= LOOP_SECONDS + FADE_SECONDS
    assert original['streams'][0]['channels'] == 2
    with tempfile.TemporaryDirectory(prefix=f'durmo-audio-{track_id}-') as tmp:
        encoded = Path(tmp) / 'track.m4a'
        # Body [8,1800] followed by tail [1800,1808] blended into head [0,8].
        # The end thus rejoins source time 8, precisely where the loop begins.
        # The same weights apply to L/R: no downmix, synthetic beat or time stretch.
        graph = (
            '[0:a]asplit=3[body][tail][head];'
            '[body]atrim=start=8:end=1800,asetpts=PTS-STARTPTS[b];'
            '[tail]atrim=start=1800:end=1808,asetpts=PTS-STARTPTS[t];'
            '[head]atrim=start=0:end=8,asetpts=PTS-STARTPTS[h];'
            '[t][h]acrossfade=d=8:c1=tri:c2=tri[join];'
            '[b][join]concat=n=2:v=0:a=1[joined];'
            # Tiny edge ramps avoid a click from AAC's independent boundary frames.
            '[joined]afade=t=in:d=0.03,afade=t=out:st=1799.97:d=0.03[out]'
        )
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin',
            '-t', str(LOOP_SECONDS + FADE_SECONDS), '-i', str(source),
            '-filter_complex', graph, '-map', '[out]', '-vn', '-map_metadata', '-1',
            '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '64k',
            '-ar', '44100', '-ac', '2', '-movflags', '+faststart', str(encoded),
        ], check=True)
        info = probe(encoded)
        assert info['streams'][0]['channels'] == 2
        assert abs(float(info['format']['duration']) - LOOP_SECONDS) < 0.1
        with encoded.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        folder = ROOT / 'media' / 'audio'
        folder.mkdir(parents=True, exist_ok=True)
        name = f'{track_id}.{digest[:16]}.m4a'
        import shutil
        shutil.copyfile(encoded, folder / name)
        result = {
            'id': track_id, 'title': f'Áudio {int(track_id):02d}', 'version': digest[:16],
            'sha256': digest, 'duration': float(info['format']['duration']),
            'size': int(info['format']['size']), 'originalSize': int(original['format']['size']),
            'codec': 'AAC-LC', 'bitrate': 64000, 'sampleRate': 44100, 'channels': 2,
            'file': name, 'crossfadeSeconds': FADE_SECONDS, 'edgeFadeSeconds': 0.03,
        }
        print(json.dumps(result, ensure_ascii=False), flush=True)
        return result


if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        tracks = list(executor.map(prepare, ['01', '02']))
    target = ROOT / 'media' / 'audio' / 'manifest.json'
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps({'tracks': tracks}, ensure_ascii=False, indent=2) + '\n')
    os.replace(temporary, target)
