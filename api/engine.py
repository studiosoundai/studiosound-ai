"""StudioSound mastering engine.

Two modes:
  - style:     tone-shaping chain (EQ, glue compression, width) + loudness to a target + true-peak limiting
  - reference: Matchering, which matches the track to a reference song's loudness, tone and width

Every style is plain data in STYLES below, so engineers can tune the sound without touching the code.
"""
import os, subprocess, tempfile
import numpy as np
import soundfile as sf
import pyloudnorm as pyln
from scipy.signal import resample_poly
from pedalboard import (Pedalboard, HighpassFilter, LowShelfFilter, HighShelfFilter,
                        PeakFilter, Compressor)

# ---------------------------------------------------------------- styles
# eq: list of (type, freq_hz, gain_db, q) ; comp: glue compressor on a -18 LUFS-normalized signal
# width: side-channel gain (1.0 = unchanged) ; low_mono_hz: below this, bass is kept mono
STYLES = {
    'balanced': {
        'label': 'Balanced', 'eq': [('low_shelf', 90, 1.0, 0.7), ('peak', 300, -1.0, 1.0), ('high_shelf', 9000, 1.5, 0.7)],
        'comp': {'threshold_db': -20, 'ratio': 2.0, 'attack_ms': 25, 'release_ms': 200}, 'width': 1.08, 'low_mono_hz': 120,
    },
    'warm': {
        'label': 'Warm', 'eq': [('low_shelf', 110, 2.0, 0.7), ('peak', 3500, -1.0, 0.9), ('high_shelf', 10000, -1.0, 0.7)],
        'comp': {'threshold_db': -20, 'ratio': 2.2, 'attack_ms': 30, 'release_ms': 250}, 'width': 1.0, 'low_mono_hz': 140,
    },
    'punchy': {
        'label': 'Punchy', 'eq': [('low_shelf', 70, 2.0, 0.8), ('peak', 250, -1.5, 1.2), ('peak', 4000, 1.0, 1.0), ('high_shelf', 11000, 1.0, 0.7)],
        'comp': {'threshold_db': -19, 'ratio': 3.0, 'attack_ms': 15, 'release_ms': 120}, 'width': 1.05, 'low_mono_hz': 130,
    },
    'open': {
        'label': 'Open', 'eq': [('low_shelf', 90, 0.5, 0.7), ('peak', 400, -1.0, 1.0), ('high_shelf', 8000, 2.5, 0.7)],
        'comp': {'threshold_db': -21, 'ratio': 1.8, 'attack_ms': 30, 'release_ms': 220}, 'width': 1.15, 'low_mono_hz': 110,
    },
    'vocal': {
        'label': 'Vocal Forward', 'eq': [('low_shelf', 90, 0.5, 0.7), ('peak', 250, -1.5, 1.0), ('peak', 2500, 1.5, 0.9), ('high_shelf', 10000, 1.0, 0.7)],
        'comp': {'threshold_db': -20, 'ratio': 2.0, 'attack_ms': 20, 'release_ms': 180}, 'width': 1.0, 'low_mono_hz': 120,
    },
}

# integrated loudness targets (LUFS) ; true-peak ceiling (dBTP)
LOUDNESS = {'streaming': -14.0, 'standard': -10.0, 'loud': -8.0}
CEILING_DBTP = -1.0
# strength: 0.5 = light touch ... 1.0 = normal ... 1.6 = max. Scales EQ moves, compression and widening.
STRENGTH_MIN, STRENGTH_MAX = 0.4, 1.7
MAX_SECONDS = 12 * 60


def _load(path):
    """Read any audio file to float32 stereo (n, 2) + sample rate. Uses ffmpeg for MP3/M4A."""
    try:
        data, sr = sf.read(path, dtype='float32', always_2d=True)
    except Exception:
        tmp = tempfile.mktemp(suffix='.wav')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-c:a', 'pcm_f32le', tmp], check=True)
        data, sr = sf.read(tmp, dtype='float32', always_2d=True)
        os.remove(tmp)
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    elif data.shape[1] > 2:
        data = data[:, :2]
    if sr < 44100:
        data = resample_poly(data, 44100, sr, axis=0).astype(np.float32); sr = 44100
    if len(data) / sr > MAX_SECONDS:
        raise ValueError('Songs can be up to 12 minutes long.')
    if len(data) / sr < 5:
        raise ValueError('That file is too short to master.')
    return data, sr


def _lufs(x, sr):
    try:
        v = pyln.Meter(sr).integrated_loudness(x)
        return float(v) if np.isfinite(v) else -70.0
    except Exception:
        return -70.0


def _true_peak_db(x):
    return 20 * np.log10(max(float(_tp_per_sample(x).max()) if len(x) else 0.0, 1e-9))


def _db(g):
    return 10 ** (g / 20)


def _width(x, sr, side_gain, low_mono_hz):
    mid = (x[:, 0] + x[:, 1]) * 0.5
    side = (x[:, 0] - x[:, 1]) * 0.5
    if low_mono_hz:
        # keep the low end mono: remove lows from the side channel
        hp = Pedalboard([HighpassFilter(cutoff_frequency_hz=low_mono_hz)])
        side = hp(side[np.newaxis, :].astype(np.float32), sr)[0]
    side = side * side_gain
    return np.stack([mid + side, mid - side], axis=1).astype(np.float32)


def _tp_per_sample(x, chunk=441000):
    """True-peak (4x oversampled) envelope at the original rate, max of both channels.
    Processed in ~10 s chunks with overlap so memory stays small on long songs."""
    n = len(x)
    out = np.empty(n, dtype=np.float32)
    pad = 64
    for a in range(0, n, chunk):
        b = min(n, a + chunk)
        lo, hi = max(0, a - pad), min(n, b + pad)
        up = np.abs(resample_poly(x[lo:hi].astype(np.float32), 4, 1, axis=0)).max(axis=1)
        up = up[(a - lo) * 4:(a - lo) * 4 + (b - a) * 4]
        if len(up) < (b - a) * 4:
            up = np.pad(up, (0, (b - a) * 4 - len(up)))
        out[a:b] = up.reshape(b - a, 4).max(axis=1)
    return out


def _limiter_gain(tp_env, sr, ceiling_lin, lookahead_ms=1.5, release_ms=60):
    """Transparent look-ahead limiter gain curve (vectorized, no per-sample loop)."""
    from scipy.ndimage import minimum_filter1d, maximum_filter1d, uniform_filter1d
    req = np.minimum(1.0, ceiling_lin / np.maximum(tp_env, 1e-9))
    L = max(2, int(sr * lookahead_ms / 1000))
    g = minimum_filter1d(req, size=2 * L + 1)              # look ahead and behind each peak
    g = uniform_filter1d(g, size=L)                         # smooth attack so gain dips before the peak
    r = 1.0 - g                                             # gain reduction
    R = max(2, int(sr * release_ms / 1000))
    r_rel = uniform_filter1d(maximum_filter1d(r, size=2 * R + 1), size=R)   # hold + smooth release
    return (1.0 - np.maximum(r, r_rel)).astype(np.float32)


def _limit_to(x, sr, target_lufs):
    """Find the input gain where gain + true-peak limiter lands on the target loudness."""
    tp = _tp_per_sample(x)
    ceil = _db(CEILING_DBTP - 0.1)
    def lim(gdb):
        G = _db(gdb)
        return (x * (G * _limiter_gain(tp * G, sr, ceil))[:, None]).astype(np.float32)
    gdb = target_lufs - _lufs(x, sr)
    y = lim(gdb)
    for _ in range(12):
        err = target_lufs - _lufs(y, sr)
        if abs(err) < 0.2:
            break
        gdb = min(gdb + err * 1.2, 40.0)
        y = lim(gdb)
    t = _true_peak_db(y)                         # final true-peak safety trim
    if t > CEILING_DBTP:
        y = (y * _db(CEILING_DBTP - t)).astype(np.float32)
    return y


def master_style(x, sr, style='balanced', loudness='standard', strength=1.0):
    s = STYLES.get(style, STYLES['balanced'])
    k = float(min(STRENGTH_MAX, max(STRENGTH_MIN, strength or 1.0)))
    target = LOUDNESS.get(loudness, LOUDNESS['standard'])
    # normalize to -18 LUFS so compressor thresholds behave the same for every mix
    y = (x * _db(-18.0 - _lufs(x, sr))).astype(np.float32)
    fx = [HighpassFilter(cutoff_frequency_hz=28)]
    for kind, f, g0, q in s['eq']:
        g = g0 * (k ** 1.6)                       # tone moves grow faster than linearly
        if kind == 'low_shelf':
            fx.append(LowShelfFilter(cutoff_frequency_hz=f, gain_db=g, q=q))
        elif kind == 'high_shelf':
            fx.append(HighShelfFilter(cutoff_frequency_hz=f, gain_db=g, q=q))
        else:
            fx.append(PeakFilter(cutoff_frequency_hz=f, gain_db=g, q=q))
    c = s['comp']
    fx.append(Compressor(threshold_db=c['threshold_db'] - 7.0 * (k - 1.0), ratio=max(1.1, 1.0 + (c['ratio'] - 1.0) * k * k),
                         attack_ms=c['attack_ms'], release_ms=c['release_ms']))
    y = Pedalboard(fx)(y.T.copy(), sr).T
    if k > 1.0:                                   # stronger settings add gentle tape-style saturation for density
        drive = 1.0 + 2.5 * (k - 1.0)
        pk = float(np.abs(y).max()) or 1.0
        z = y / pk
        y = (np.tanh(drive * z) / np.tanh(drive) * pk).astype(np.float32)
    y = _width(y, sr, 1.0 + (s['width'] - 1.0) * k, s['low_mono_hz'])
    return _limit_to(y, sr, target)


def master_reference(target_path, reference_path, out_path):
    import matchering as mg
    mg.process(target=target_path, reference=reference_path, results=[mg.pcm24(out_path)])
    y, sr = sf.read(out_path, dtype='float32', always_2d=True)
    tp = _true_peak_db(y)
    if tp > CEILING_DBTP:
        y = (y * _db(CEILING_DBTP - tp)).astype(np.float32)
        sf.write(out_path, y, sr, subtype='PCM_24')
    return y, sr


def loudest_window(x, sr, seconds=30):
    """Start (s) of the loudest `seconds` stretch, usually the chorus, for the preview."""
    if len(x) <= seconds * sr:
        return 0.0
    block = sr // 10                                  # 0.1 s blocks
    nb = len(x) // block
    e = np.mean((x[:nb * block] ** 2).reshape(nb, block, 2), axis=(1, 2))
    win = int(seconds * 10)
    sums = np.convolve(e, np.ones(win), mode='valid')
    start = int(np.argmax(sums)) / 10.0
    return float(min(start, len(x) / sr - seconds))


def write_preview(y, sr, start, out_mp3, seconds=None):
    """Preview MP3. seconds=None -> the whole song (128 kbps); otherwise a faded clip."""
    if seconds is None:
        seg = y
    else:
        a, b = int(start * sr), int(min(len(y), (start + seconds) * sr))
        seg = y[a:b].copy()
        fade = int(sr * 1.0)
        if len(seg) > 2 * fade:
            ramp = np.linspace(0, 1, fade, dtype=np.float32)[:, None]
            seg[:fade] *= ramp
            seg[-fade:] *= ramp[::-1]
    tmp = tempfile.mktemp(suffix='.wav')
    sf.write(tmp, seg, sr, subtype='PCM_16')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-c:a', 'libmp3lame', '-b:a', '128k' if seconds is None else '192k', out_mp3], check=True)
    os.remove(tmp)


def run(input_path, out_wav, out_preview, style='balanced', loudness='standard', reference_path=None, strength=1.0):
    """Master a file. Returns metrics. Writes a 24-bit WAV master and a 30-second MP3 preview."""
    x, sr = _load(input_path)
    before = {'lufs': round(float(_lufs(x, sr)), 1), 'true_peak': round(float(_true_peak_db(x)), 1)}
    if reference_path:
        # Matchering wants WAV files at a common rate
        tgt = tempfile.mktemp(suffix='.wav'); sf.write(tgt, x, sr, subtype='FLOAT')
        r, rsr = _load(reference_path)
        ref = tempfile.mktemp(suffix='.wav'); sf.write(ref, r, rsr, subtype='FLOAT')
        y, sr = master_reference(tgt, ref, out_wav)
        os.remove(tgt); os.remove(ref)
    else:
        y = master_style(x, sr, style, loudness, strength)
        sf.write(out_wav, y, sr, subtype='PCM_24')
    start = loudest_window(x, sr)          # where the chorus probably is; the player starts here
    write_preview(y, sr, 0.0, out_preview)  # the whole song
    after = {'lufs': round(float(_lufs(y, sr)), 1), 'true_peak': round(float(_true_peak_db(y)), 1)}
    return {'before': before, 'after': after, 'preview_start': round(start, 1),
            'duration': round(len(y) / sr, 1), 'sample_rate': sr, 'full_preview': True,
            'strength': None if reference_path else round(float(min(STRENGTH_MAX, max(STRENGTH_MIN, strength or 1.0))), 2)}
