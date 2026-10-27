"""StudioSound mastering server.

Runs on its own small server (Render), not Vercel. Vercel creates a job row in Supabase and calls
POST /jobs; this server downloads the song from Supabase Storage, masters it, uploads the master and
a 30-second preview, and marks the job done. Files are deleted automatically after RETENTION_DAYS.

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MASTERING_SECRET, (optional) MAX_PARALLEL, RETENTION_DAYS
"""
import os, re, tempfile, threading, traceback, datetime
import httpx
from fastapi import FastAPI, Header, HTTPException, BackgroundTasks
from pydantic import BaseModel
import engine

def _clean_key(raw):
    """Pull the real key out of whatever was pasted (stray labels, arrows, spaces, line breaks)."""
    raw = raw or ''
    m = re.search(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', raw) or re.search(r'sb_secret_[A-Za-z0-9_-]+', raw)
    return m.group(0) if m else ''.join(c for c in raw if c.isascii() and not c.isspace())


SB_RAW = os.environ.get('SUPABASE_URL', '')
_m = re.search(r'https://[a-z0-9]+\.supabase\.co', SB_RAW)
SB = _m.group(0) if _m else SB_RAW.strip().rstrip('/')
KEY_RAW = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
KEY = _clean_key(KEY_RAW)
SECRET = os.environ.get('MASTERING_SECRET', '').strip()
BUCKET = 'mastering'
RETENTION_DAYS = int(os.environ.get('RETENTION_DAYS', '14'))
SLOTS = threading.Semaphore(int(os.environ.get('MAX_PARALLEL', '2')))   # keep memory in check

# New secret keys (sb_secret_...) go only in the apikey header; old service_role JWTs also go in Authorization.
H = {'apikey': KEY} if KEY.startswith('sb_secret_') else {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
app = FastAPI(title='StudioSound Mastering')


def db_get(job_id):
    r = httpx.get(f'{SB}/rest/v1/master_jobs', params={'id': f'eq.{job_id}', 'select': '*'}, headers=H, timeout=20)
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def db_update(job_id, fields):
    r = httpx.patch(f'{SB}/rest/v1/master_jobs', params={'id': f'eq.{job_id}'},
                    headers={**H, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'}, json=fields, timeout=20)
    r.raise_for_status()


def storage_download(path, dest):
    with httpx.stream('GET', f'{SB}/storage/v1/object/{BUCKET}/{path}', headers=H, timeout=300) as r:
        r.raise_for_status()
        with open(dest, 'wb') as f:
            for chunk in r.iter_bytes():
                f.write(chunk)


def storage_upload(path, src, content_type):
    with open(src, 'rb') as f:
        r = httpx.post(f'{SB}/storage/v1/object/{BUCKET}/{path}', content=f.read(),
                       headers={**H, 'Content-Type': content_type, 'x-upsert': 'true'}, timeout=300)
    r.raise_for_status()


def cleanup_old():
    """Delete files of jobs older than RETENTION_DAYS (runs before each job; cheap)."""
    try:
        cutoff = (datetime.datetime.utcnow() - datetime.timedelta(days=RETENTION_DAYS)).isoformat() + 'Z'
        r = httpx.get(f'{SB}/rest/v1/master_jobs', headers=H, timeout=20, params={
            'select': 'id,input_path,reference_path,master_path,preview_path', 'created_at': f'lt.{cutoff}',
            'purged': 'is.false', 'limit': '50'})
        r.raise_for_status()
        for j in r.json():
            paths = [p for p in (j.get('input_path'), j.get('reference_path'), j.get('master_path'), j.get('preview_path')) if p]
            if paths:
                httpx.request('DELETE', f'{SB}/storage/v1/object/{BUCKET}', headers={**H, 'Content-Type': 'application/json'},
                              json={'prefixes': paths}, timeout=30)
            db_update(j['id'], {'purged': True})
    except Exception:
        traceback.print_exc()


def process(job_id):
    try:
        _process(job_id)
    except Exception:
        traceback.print_exc()
        try:
            db_update(job_id, {'status': 'failed', 'error': 'Mastering hit a server problem. Try again in a minute.'})
        except Exception:
            traceback.print_exc()


def _process(job_id):
    with SLOTS:
        job = db_get(job_id)
        if not job or job.get('status') not in ('queued', 'failed'):
            return
        db_update(job_id, {'status': 'processing', 'error': None})
        tmp = tempfile.mkdtemp()
        try:
            ext = os.path.splitext(job['input_path'])[1] or '.wav'
            src = os.path.join(tmp, 'input' + ext)
            storage_download(job['input_path'], src)
            ref = None
            if job.get('reference_path'):
                ref = os.path.join(tmp, 'reference' + (os.path.splitext(job['reference_path'])[1] or '.wav'))
                storage_download(job['reference_path'], ref)
            out_wav, out_mp3 = os.path.join(tmp, 'master.wav'), os.path.join(tmp, 'preview.mp3')
            metrics = engine.run(src, out_wav, out_mp3, style=job.get('style') or 'balanced',
                                 loudness=job.get('loudness') or 'standard', reference_path=ref,
                                 strength=float(job.get('strength') or 1.0))
            base = job['input_path'].rsplit('/', 1)[0]
            master_path, preview_path = f'{base}/master.wav', f'{base}/preview.mp3'
            storage_upload(preview_path, out_mp3, 'audio/mpeg')
            storage_upload(master_path, out_wav, 'audio/wav')
            db_update(job_id, {'status': 'done', 'metrics': metrics, 'master_path': master_path, 'preview_path': preview_path})
        except ValueError as e:                       # friendly errors from the engine (too long, too short)
            db_update(job_id, {'status': 'failed', 'error': str(e)})
        except Exception:
            traceback.print_exc()
            db_update(job_id, {'status': 'failed', 'error': 'We couldn\'t master that file. Try exporting it again as a WAV.'})
        finally:
            for f in os.listdir(tmp):
                try: os.remove(os.path.join(tmp, f))
                except Exception: pass
            try: os.rmdir(tmp)
            except Exception: pass


class Job(BaseModel):
    job_id: str


@app.get('/health')
def health():
    return {'ok': True, 'styles': {k: v['label'] for k, v in engine.STYLES.items()}}


@app.get('/check')
def check():
    """Setup check: is the Supabase connection right? Never shows the key itself."""
    out = {
        'supabase_url': SB,
        'url_looks_right': bool(re.fullmatch(r'https://[a-z0-9]+\.supabase\.co', SB)),
        'key_found': bool(KEY),
        'key_type': 'jwt' if KEY.startswith('eyJ') else ('sb_secret' if KEY.startswith('sb_secret_') else 'unknown'),
        'key_had_extra_characters': KEY != KEY_RAW,
        'secret_set': bool(SECRET),
    }
    try:
        r = httpx.get(f'{SB}/rest/v1/master_jobs', params={'select': 'id', 'limit': '1'}, headers=H, timeout=15)
        out['database'] = 'ok' if r.status_code == 200 else f'error {r.status_code}: {r.text[:160]}'
    except Exception as e:
        out['database'] = f'error: {type(e).__name__}: {str(e)[:160]}'
    try:
        r = httpx.post(f'{SB}/storage/v1/object/list/{BUCKET}', json={'prefix': '', 'limit': 1}, headers={**H, 'Content-Type': 'application/json'}, timeout=15)
        out['storage'] = 'ok' if r.status_code == 200 else f'error {r.status_code}: {r.text[:160]}'
    except Exception as e:
        out['storage'] = f'error: {type(e).__name__}: {str(e)[:160]}'
    out['ready'] = out['database'] == 'ok' and out['storage'] == 'ok' and out['secret_set']
    return out


@app.post('/jobs', status_code=202)
def start(job: Job, background: BackgroundTasks, x_mastering_secret: str = Header(default='')):
    if not SECRET or x_mastering_secret != SECRET:
        raise HTTPException(status_code=401, detail='unauthorized')
    background.add_task(cleanup_old)
    background.add_task(process, job.job_id)
    return {'queued': job.job_id}
