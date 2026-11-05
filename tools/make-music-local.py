r"""Generate the battle music locally with MusicGen (audiocraft), on the owner's GPU.

Run with the AudioStudio audiocraft venv (see Mallet-Swordtip tools/local-audio/README.md for its setup):

  %USERPROFILE%\AudioStudio\audiocraft\Scripts\python.exe tools\make-music-local.py [--takes 2] [--seconds 90] [name ...]
  ... make-music-local.py --score                                         # CLAP match + sanity for every take
  ... make-music-local.py --encode battle_1=2 battle_2=1 battle_3=1      # chosen takes -> public/audio/music/<name>.mp3

Takes land in ~/AudioStudio/out/assembly-forge/<name>-<n>.wav. Encoding fades the ends, normalises loudness and writes a
128 kbps stereo MP3 with ffmpeg (on PATH). The prompts describe a style, never a series, song or artist: the music is
our own. MusicGen writes 30 seconds at a time; longer tracks continue from the last 12 seconds of the window.
"""
import argparse
import os
import subprocess
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
STUDIO = Path(os.environ.get('AUDIO_STUDIO', Path.home() / 'AudioStudio'))
OUT = STUDIO / 'out' / 'assembly-forge'

STYLE = 'energetic 1980s japanese giant robot anime battle theme, hot-blooded and heroic, instrumental'
TRACKS = {
    'battle_1': STYLE + ', driving rock drums 150 bpm, crunchy distorted electric guitar riffs, slap bass, '
                        'bright brass section stabs, soaring synth brass lead melody, triumphant major key',
    'battle_2': STYLE + ', dark heavy minor key, galloping metal rhythm guitars, pounding toms and timpani, '
                        'orchestral strings and french horns, fiery guitar solo, relentless 160 bpm',
    'battle_3': STYLE + ', synth driven space war, pulsing synth bass arpeggios, gated reverb drums, power chords, '
                        'heroic trumpet-like synth lead, choir pads, 140 bpm',
}

ap = argparse.ArgumentParser()
ap.add_argument('names', nargs='*')
ap.add_argument('--takes', type=int, default=2)
ap.add_argument('--seconds', type=float, default=90)
ap.add_argument('--encode', action='store_true', help='names are name=take pairs to encode into the game')
ap.add_argument('--score', action='store_true', help='rate every take against its prompt')
args = ap.parse_args()
OUT.mkdir(parents=True, exist_ok=True)

if args.encode:
    dest = REPO / 'public' / 'audio' / 'music'
    dest.mkdir(parents=True, exist_ok=True)
    for pair in args.names:
        name, take = pair.split('=')
        src = OUT / f'{name}-{take}.wav'
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(src)],
                                   capture_output=True, text=True, check=True).stdout)
        af = f'afade=t=in:d=0.6,afade=t=out:st={max(0.0, dur - 3.0):.2f}:d=3,loudnorm=I=-16:TP=-1.5:LRA=11'
        out = dest / f'{name}.mp3'
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-af', af, '-ar', '44100', '-ac', '2', '-b:a', '128k', str(out)], check=True)
        print(f'{name}: take {take}, {dur:.0f}s, {out.stat().st_size / 1e6:.2f} MB', flush=True)
    sys.exit(0)

import soundfile as sf  # noqa: E402
import torch  # noqa: E402

if args.score:
    import numpy as np
    import torchaudio.functional as AF
    from transformers import ClapModel, ClapProcessor
    m = ClapModel.from_pretrained('laion/larger_clap_general').to('cuda').eval()
    proc = ClapProcessor.from_pretrained('laion/larger_clap_general')

    def feat(o):
        return o if torch.is_tensor(o) else getattr(o, 'pooler_output', o[0])

    for name, prompt in TRACKS.items():
        with torch.no_grad():
            tf = torch.nn.functional.normalize(feat(m.get_text_features(**{k: v.to('cuda') for k, v in proc(text=[prompt], return_tensors='pt', padding=True).items()})), dim=-1)
        for w in sorted(OUT.glob(name + '-*.wav')):
            x, sr = sf.read(str(w), dtype='float32')
            mono = torch.from_numpy(x.mean(1))
            a = AF.resample(mono, sr, 48000).numpy()
            n = len(a)
            scores = []
            for start in (0, n // 2 - 240000, n - 480000):  # three 10 s windows: start, middle, end
                seg = a[max(0, start):max(0, start) + 480000]
                with torch.no_grad():
                    af = feat(m.get_audio_features(**{k: v.to('cuda') for k, v in proc(audio=[seg], sampling_rate=48000, return_tensors='pt').items()}))
                scores.append(float((torch.nn.functional.normalize(af, dim=-1) * tf).sum()))
            frames = mono.numpy()[: len(mono) // 2048 * 2048].reshape(-1, 2048)
            db = 20 * np.log10(np.sqrt((frames ** 2).mean(1)) + 1e-9)
            quiet = float((db < db.max() - 30).mean())
            clip = float((np.abs(x) > 0.99).mean())
            print(f'{w.stem:12s} clap {np.mean(scores):.3f} (start {scores[0]:.2f} mid {scores[1]:.2f} end {scores[2]:.2f})  quiet {quiet:.2f}  clip {clip:.4f}', flush=True)
    sys.exit(0)

from audiocraft.models import MusicGen  # noqa: E402

model = MusicGen.get_pretrained('facebook/musicgen-stereo-medium', device='cuda')
model.set_generation_params(duration=args.seconds, use_sampling=True, top_k=250, cfg_coef=3.0, extend_stride=18)
for name in args.names or list(TRACKS):
    torch.manual_seed(zlib.crc32(name.encode()))
    print('gen', name, f'{args.seconds:.0f}s x{args.takes}', flush=True)
    wav = model.generate([TRACKS[name]] * args.takes, progress=False).cpu()
    for n, w in enumerate(wav):
        sf.write(str(OUT / f'{name}-{n + 1}.wav'), w.T.numpy(), model.sample_rate)
    torch.cuda.empty_cache()
print('done', flush=True)
