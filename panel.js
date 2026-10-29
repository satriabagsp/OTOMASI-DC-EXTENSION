/* ============================================================================
 * OTOMASI DC Extension — panel generik di halaman fasih-sm.bps.go.id (MAIN world).
 * ----------------------------------------------------------------------------
 * Panel tidak tahu apa pun tentang jenis update. Logika & kolom sheet datang dari
 * file batch-automation.js yang di-import lewat tombol "Import script". File itu
 * mendaftarkan diri dengan:
 *
 *   OTOMASI_DC_BATCH.register({
 *     id, name, description,
 *     columns:  [{ key, title?, type?: 'text'|'uuid'|'number'|'integer'|'select'|'date', required?, unique?, width?, mono?, trim? }],
 *               type 'select': choices [{ value, label }] (dropdown; sel berisi label), multiple? (pisah ;)
 *               type 'date'  : input 'date'|'datetime-local'|'time'|'month'|'week' (pemilih bawaan browser)
 *     idColumn: 'assignment_id',          // dipakai FASIH.init() & backup; default kolom uuid pertama
 *     options:  [{ key, label, type: 'checkbox'|'number'|'text'|'select', default, choices? }],
 *     remarks:  [{ dataKey, key?, title?, width? }],   // opsional; kolom remark muncul saat toggle Remark aktif
 *     validateRow(row)  -> null | 'pesan' | { kolom: 'pesan' },
 *     before(rows, ctx), after(results, ctx),            // opsional
 *     async process(row, ctx) -> { skip?, status?, code?, ket?, remarkKeys? },
 *   })
 *   ctx = { dryRun, options, FASIH, index, total, rowNumber, sleep, remarks }
 *
 * Remark: kalau toggle Remark aktif, tiap sel remark yang terisi ditulis sebagai catatan
 * per-pertanyaan lewat FASIH.setComment(id, dataKey, teks) setelah process() berhasil
 * (bukan LEWATI/GAGAL). Teks yang sama persis di dataKey itu tidak ditulis dua kali.
 * ctx.remarks = remark terisi di baris itu [{ dataKey, text }] ([] kalau toggle mati).
 * Field roster (dataKey#n): process() mengembalikan remarkKeys { dataKey: 'dataKey#n' }
 * supaya catatan ditulis ke baris yang benar, mis. { nama_usaha: 'nama_usaha#1001' }.
 *
 * Kode script dijalankan dengan AsyncFunction (butuh 'unsafe-eval' di CSP halaman);
 * kalau CSP menolak, dijalankan lewat chrome.userScripts (bridge.js + background.js).
 *
 * Menu di header (urut): "Custom automation" (menu default saat halaman dibuka; FASIH Sheet:
 * import kuesioner HTML, isi assignment_id -> data dimuat dari get-by-assignment-id; halaman
 * custom/sheet.html dijalankan di iframe srcdoc supaya berjalan di origin FASIH dan memakai login
 * yang sama), "Script-based automation" (sheet + script di atas), dan "Restore" (kembalikan
 * assignment ke isi file backup .json dari FASIH.backup / "Backup sebelum LIVE").
 * ==========================================================================*/

(() => {
  if (window.OTOMASI_DC_BATCH) return;
  const F = () => (typeof FASIH !== 'undefined' ? FASIH : window.FASIH);

  /* ---------------- penyimpanan (localStorage origin FASIH) ---------------- */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('[OTOMASI_DC_BATCH] gagal menyimpan', k, e); } },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const K = { code: 'otomasi-dc-ext:code', rows: (id) => `otomasi-dc-ext:rows:${id}`, settings: (id) => `otomasi-dc-ext:settings:${id}`,
              restore: 'otomasi-dc-ext:restore-settings', approval: 'otomasi-dc-ext:approval-queue' };

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const BASE = { jeda: 8000, backup: false, remark: true };
  const SETTINGS_V = 5;      // v5: jeda lebih aman dan remark dikirim dalam satu request
  const RESULT_COLS = [
    { key: '_status', title: 'status', width: 90 },
    { key: '_code', title: 'code_identity', width: 210, mono: true },
    { key: '_ket', title: 'keterangan', width: 520 },
  ];
  const STATUS_CLASS = { 'OK': 'st-ok', 'SELESAI': 'st-ok', 'SUDAH_DIKERJAKAN': 'st-ok', 'APPROVED': 'st-ok', 'DRY RUN': 'st-dry', 'LEWATI': 'st-skip', 'GAGAL': 'st-fail', 'GAGAL APPROVE': 'st-fail', 'PROSES…': 'st-run', 'ANTRI': 'st-queue' };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let mod = null, sheet = null, S = { ...BASE }, running = false, abort = false, invalid = new Map(), regCount = 0;
  let rsheet = null, rfile = null, rinvalid = new Map();     // menu Restore: sheet, file backup { name, createdAt, items: Map }, baris tidak valid

  /* ---------------- DOM (shadow root, terisolasi dari CSS halaman) ---------------- */
  const host = document.createElement('div');
  host.id = 'otomasi-dc-ext-host';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }
  .fab { position: fixed; right: 24px; bottom: 24px; z-index: 2147483000; height: 42px; padding: 0 18px;
         border: 0; border-radius: 11px; background: #123b6d; color: #fff; font: 700 13px Arial, sans-serif;
         box-shadow: 0 5px 16px rgba(13,42,77,.28); cursor: pointer; }
  .fab:hover { background: #0a2d55; }
  .fab[hidden], .panel[hidden], [hidden] { display: none !important; }
  .panel { position: fixed; inset: 30px; z-index: 2147483001; display: flex; flex-direction: column; overflow: hidden;
           background: #fff; color: #192b3a; font: 13px/1.4 Arial, sans-serif; border-radius: 14px;
           box-shadow: 0 14px 48px rgba(8,35,66,.30); border: 1px solid #d7e3ee; }
  header { display: flex; align-items: center; gap: 10px; padding: 13px 18px; color: #fff;
           background: linear-gradient(112deg, #102f57, #155f86); }
  header .logo { width: 30px; height: 30px; border-radius: 8px; background: #f3b33d; color: #173653; display: grid; place-items: center; font-weight: 800; font-size: 12px; flex: none; }
  header .title { font-size: 16px; font-weight: 800; white-space: nowrap; letter-spacing: .1px; }
  header .sub { color: #dbeeff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  header .sub b { color: #fff; }
  nav.menu { display: flex; gap: 2px; flex: none; }
  nav.menu button { height: 30px; padding: 0 12px; border: 0; border-radius: 4px; background: none; color: #3c4043;
                    font: 500 13px Arial, sans-serif; cursor: pointer; }
  nav.menu button:hover:not(:disabled) { background: #f1f3f4; }
  nav.menu button.on { background: #e6f4ea; color: #137333; font-weight: 700; }
  nav.menu button:disabled { opacity: .45; cursor: default; }
  .hdr-auto { display: contents; }
  .view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .custom-box { flex: 1; min-height: 0; display: flex; }
  .custom-frame { flex: 1; width: 100%; height: 100%; border: 0; background: #fff; }
  header .script { color: #3c4043; background: #f1f3f4; border-radius: 12px; padding: 3px 10px; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
  .spacer { flex: 1; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 16px; background: #f4f8fb; border-bottom: 1px solid #d7e3ee; }
  .toolbar label { display: inline-flex; align-items: center; gap: 4px; color: #3c4043; white-space: nowrap; }
  .toolbar input[type=number], .toolbar input[type=text], .toolbar select { height: 26px; padding: 0 6px; border: 1px solid #dadce0; border-radius: 4px; font: inherit; background: #fff; }
  .toolbar input[type=number] { width: 80px; }
  .opts { display: contents; }
  .sep { width: 1px; height: 22px; background: #dadce0; }
  button.b { height: 32px; padding: 0 14px; border-radius: 7px; border: 1px solid #c8d8e6; background: #fff; color: #21415f; font: 700 12px Arial, sans-serif; cursor: pointer; white-space: nowrap; }
  button.b:hover:not(:disabled) { background: #e9f3f9; border-color: #75a9c9; }
  button.b:disabled { opacity: .45; cursor: default; }
  button.dry { border-color: #16758a; color: #0e6679; background: #effbfd; }
  button.live { border-color: #f0a323; background: #e78913; color: #fff; }
  button.live:hover:not(:disabled) { background: #c97008; }
  button.x { border: 0; background: rgba(255,255,255,.12); font-size: 18px; color: #fff; cursor: pointer; width: 32px; height: 32px; border-radius: 8px; flex: none; }
  button.x:hover { background: rgba(255,255,255,.22); }
  .hint { padding: 6px 14px; color: #5f6368; border-bottom: 1px solid #dadce0; }
  kbd { font: 11px monospace; padding: 1px 4px; border: 1px solid #dadce0; border-radius: 3px; background: #f8f9fa; }
  code { font: 12px Consolas, monospace; background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }
  .grid { flex: 1; min-height: 0; display: flex; }
  .empty { margin: auto; max-width: 520px; text-align: center; color: #3c4043; padding: 24px; }
  .empty .big { font-size: 40px; color: #188038; }
  .empty p { color: #5f6368; line-height: 1.6; }
  footer { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-top: 1px solid #dadce0; background: #f8f9fa; min-height: 38px; }
  .summary { color: #3c4043; white-space: nowrap; }
  .progress { width: 160px; height: 6px; border-radius: 3px; background: #e8eaed; overflow: hidden; flex: none; }
  .progress div { height: 100%; width: 0; background: #1a73e8; transition: width .2s; }
  .msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #3c4043; }
  .msg.err { color: #d93025; font-weight: 600; }
  .credit { color: #61788d; font-size: 11px; white-space: nowrap; }

  /* ---- grid ---- */
  .sheet { flex: 1; overflow: auto; position: relative; }
  .sheet table { border-collapse: separate; border-spacing: 0; table-layout: fixed; width: max-content; user-select: none; }
  .sheet th, .sheet td { height: 23px; padding: 0 6px; border-right: 1px solid #e2e3e3; border-bottom: 1px solid #e2e3e3;
                         white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; cursor: cell; }
  .sheet thead th { position: sticky; top: 0; z-index: 2; background: #f8f9fa; color: #3c4043; font-weight: 400; text-align: left; border-bottom-color: #c0c0c0; cursor: default; }
  .sheet thead th .letter { color: #80868b; margin-right: 6px; font-size: 11px; }
  .sheet th.rn, .sheet th.corner { position: sticky; left: 0; z-index: 1; background: #f8f9fa; color: #5f6368; text-align: center; font-size: 11px; border-right-color: #c0c0c0; cursor: default; }
  .sheet th.corner { z-index: 3; }
  .sheet th.hl { background: #d3e3fd; color: #0b57d0; font-weight: 600; }
  .sheet td.mono { font-family: Consolas, 'Roboto Mono', monospace; font-size: 12px; }
  .sheet td.ro { background: #fafafa; color: #5f6368; }
  .sheet td.invalid { background: #fce8e6; }
  .sheet td.st-ok { color: #188038; font-weight: 600; }
  .sheet td.st-dry { color: #1a73e8; font-weight: 600; }
  .sheet td.st-skip { color: #80868b; font-weight: 600; }
  .sheet td.st-fail { color: #d93025; font-weight: 600; }
  .sheet td.st-run { color: #b06000; font-weight: 600; background: #fef7e0; }
  .b.approve { background: #0d7a6c; color: #fff; border-color: #0d7a6c; }
  .b.approve:hover:not(:disabled) { background: #086557; }
  .sheet td.st-queue { color: #9aa0a6; }
  .sheet td.err-text { color: #d93025; }
  .sheet td.sel { background-color: #e8f0fe; }
  .sheet td.invalid.sel { background-color: #f6d6d3; }
  .sheet td.active { outline: 2px solid #1a73e8; outline-offset: -2px; }
  .sheet td.editing { padding: 0 4px; outline: 2px solid #1a73e8; outline-offset: -2px; background: #fff; }
  .sheet td input { width: 100%; height: 100%; border: 0; outline: 0; padding: 0; font: inherit; background: #fff; color: inherit; }
  .sheet td.dd { position: relative; padding-right: 16px; }
  .sheet td.dd::after { content: '▾'; position: absolute; right: 4px; top: 0; line-height: 23px; color: #80868b; font-size: 11px; }
  .sheet .dd-pop { position: fixed; z-index: 30; max-width: 480px; background: #fff; border: 1px solid #c0c0c0; border-radius: 6px;
                   box-shadow: 0 6px 20px rgba(0,0,0,.18); display: flex; flex-direction: column; font-size: 13px; }
  .sheet .dd-q { margin: 6px; padding: 4px 8px; border: 1px solid #c0c0c0; border-radius: 4px; font: inherit; outline: none; }
  .sheet .dd-q:focus { border-color: #1a73e8; }
  .sheet .dd-list { max-height: 220px; overflow: auto; padding: 0 4px 4px; }
  .sheet .dd-it { padding: 4px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
  .sheet .dd-it.hi { background: #e8f0fe; }
  .sheet .dd-it.on { font-weight: 600; }
  .sheet .dd-box { margin-right: 6px; }
  .sheet .dd-none { padding: 6px 8px; color: #80868b; }
  .sheet .dd-foot { display: flex; gap: 6px; align-items: center; padding: 6px; border-top: 1px solid #e2e3e3; font-size: 11px; color: #80868b; }
  .sheet .dd-foot button { font: inherit; font-size: 12px; padding: 2px 8px; border: 1px solid #c0c0c0; border-radius: 4px; background: #fff; cursor: pointer; }
  .sheet .kb { position: fixed; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; resize: none; }
</style>
<button class="fab" title="Otomasi Perbaikan BPS Jabar">Buka Otomasi BPS Jabar</button>
<div class="panel" hidden>
  <header>
    <span class="logo">JB</span><span class="title">Otomasi Perbaikan BPS Jabar</span>
    <span class="sub">SE2026 L Blok II · nilai, remark, dan persetujuan</span>
    <span class="spacer"></span>
    <span class="hdr-auto" hidden>
      <span class="script" hidden></span>
      <button class="b" data-act="template" title="Unduh template batch-automation.js untuk dikembangkan">Download template</button>
      <button class="b" data-act="import" title="Pilih file batch-automation.js">Import script</button>
      <button class="b" data-act="unload" hidden title="Lepas script (data sheet tetap tersimpan)">Lepas</button>
    </span>
    <button class="x" data-act="close" title="Tutup (data tetap tersimpan)">✕</button>
    <input type="file" class="f-script" accept=".js,text/javascript" hidden>
    <input type="file" class="f-data" accept=".csv,text/csv" hidden>
    <input type="file" class="f-backup" accept=".json,application/json" hidden>
  </header>
  <div class="view v-auto">
  <div class="toolbar" hidden>
    <button class="b" data-act="loadcsv" title="Muat file CSV batch siap input tanpa salin-tempel">Muat CSV batch</button>
    <button class="b dry" data-act="dry">Dry run</button>
    <button class="b live" data-act="live">Jalankan LIVE</button>
    <button class="b approve" data-act="approve" title="Membuka tiap assignment hasil LIVE dan menekan Approve hanya bila tombolnya tersedia">Approve hasil LIVE</button>
    <button class="b" data-act="stopapprove" title="Hentikan antrean approve setelah halaman ini">Hentikan approve</button>
    <button class="b" data-act="stop" disabled>Hentikan proses</button>
    <span class="sep"></span>
    <label>Jeda <input type="number" data-set="jeda" min="0" step="500"> ms</label>
    <span class="opts"></span>
    <span class="spacer"></span>
    <button class="b" data-act="export" title="Unduh hasil tiap assignment untuk rekonsiliasi database">Unduh hasil CSV</button>
    <button class="b" data-act="resetStatus" title="Kosongkan kolom status, code_identity, keterangan">Hapus status</button>
    <button class="b" data-act="clear">Kosongkan</button>
  </div>
  <div class="hint" hidden></div>
  <div class="grid">
    <div class="empty">
      <div class="big">⊞</div>
      <b>Menyiapkan antrean BPS Jabar…</b>
      <p>Refresh halaman FASIH bila tampilan ini tidak memuat otomatis.</p>
    </div>
  </div>
  </div>
  <div class="view v-restore" hidden>
    <div class="toolbar" hidden>
      <button class="b" data-act="rfile" title="Ganti file backup .json">Pilih file backup</button>
      <span class="sep"></span>
      <button class="b dry" data-act="rdry">Dry run</button>
      <button class="b live" data-act="rlive">Restore LIVE</button>
      <button class="b" data-act="rstop" disabled>Stop</button>
      <span class="sep"></span>
      <label>Jeda <input type="number" data-rset="jeda" min="0" step="500"> ms</label>
      <label title="Unduh fasih-backup-sebelum-restore-*.json berisi kondisi record saat ini, supaya restore bisa dibatalkan"><input type="checkbox" data-rset="backup"> Backup kondisi sekarang sebelum LIVE</label>
      <span class="spacer"></span>
      <button class="b" data-act="rresetStatus" title="Kosongkan kolom status, versi, keterangan">Hapus status</button>
      <button class="b" data-act="rclose" title="Tutup file backup">Tutup file</button>
    </div>
    <div class="hint" hidden></div>
    <div class="grid">
      <div class="empty">
        <div class="big">⟲</div>
        <b>Belum ada file backup</b>
        <p>Pilih file <code>fasih-backup-*.json</code> (dari <b>Backup sebelum LIVE</b> atau <code>FASIH.backup</code>).<br>
           Tiap assignment di file dikembalikan ke isi backup: jawaban, catatan, dan kolom data1–data10.</p>
        <button class="b dry" data-act="rfile">Pilih file backup</button>
      </div>
    </div>
  </div>
  <div class="view v-custom" hidden>
    <div class="custom-box"><div class="empty"><div class="big">⊞</div><b>Memuat FASIH Sheet…</b></div></div>
  </div>
  <footer><span class="summary"></span><div class="progress"><div></div></div><span class="msg"></span><span class="credit">Berbasis fasih-batch-extension oleh Nahar · dioptimalkan untuk BPS Jabar</span></footer>
</div>`;

  const $ = (s) => root.querySelector(s);
  const A = (s) => root.querySelector(`.v-auto ${s}`), R = (s) => root.querySelector(`.v-restore ${s}`);
  const panel = $('.panel'), fab = $('.fab'), fileInput = $('.f-script'), dataInput = $('.f-data'), empty = A('.empty');
  let view = 'auto';                                    // menu aktif: 'auto' | 'restore' | 'custom'

  /* ---------------- status bar ---------------- */
  function msg(text, kind = '') { const m = $('.msg'); m.textContent = text; m.className = 'msg ' + kind; m.title = text; }
  function progress(done, total) { $('.progress div').style.width = total ? `${(done / total) * 100}%` : '0'; }
  /* Opsi FASIH.backup: progres per record di pesan & progress bar, tombol Stop menghentikan backup */
  const backupOpts = () => ({
    onProgress: (n, total, id) => { msg(`Backup ${n}/${total} — ${id}`); progress(n - 1, total); },
    shouldStop: () => abort,
  });

  /* ---------------- definisi script ---------------- */
  // format nilai kolom type 'date' (sama dengan nilai <input type=...>)
  const DATE_RE = {
    date: /^\d{4}-\d{2}-\d{2}$/, 'datetime-local': /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/,
    time: /^\d{2}:\d{2}(:\d{2})?$/, month: /^\d{4}-\d{2}$/, week: /^\d{4}-W\d{2}$/,
  };
  function normalize(def) {
    if (!def || typeof def !== 'object') throw new Error('register() butuh objek definisi');
    if (!def.id) throw new Error('definisi butuh "id"');
    if (!Array.isArray(def.columns) || !def.columns.length) throw new Error('definisi butuh "columns" (minimal 1 kolom)');
    if (typeof def.process !== 'function') throw new Error('definisi butuh fungsi "process(row, ctx)"');
    const keys = new Set();
    const columns = def.columns.map((c) => {
      const col = typeof c === 'string' ? { key: c } : { ...c };
      if (!col.key || String(col.key).startsWith('_')) throw new Error(`kolom tidak valid: ${JSON.stringify(c)} (key wajib, tidak boleh diawali "_")`);
      if (keys.has(col.key)) throw new Error(`kolom ganda: ${col.key}`);
      keys.add(col.key);
      const type = col.type || 'text';
      if (!['text', 'uuid', 'number', 'integer', 'select', 'date'].includes(type)) throw new Error(`kolom ${col.key}: type "${type}" tidak dikenal`);
      const extra = {};
      if (type === 'select') {
        if (!Array.isArray(col.choices) || !col.choices.length) throw new Error(`kolom ${col.key}: type "select" butuh choices [{ value, label }]`);
        extra.choices = col.choices.map((o) => (o && typeof o === 'object'
          ? { value: String(o.value ?? o.label), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) }));
        extra.multiple = !!col.multiple;
      }
      if (type === 'date') {
        extra.input = col.input || 'date';
        if (!DATE_RE[extra.input]) throw new Error(`kolom ${col.key}: input "${extra.input}" tidak dikenal (date, datetime-local, time, month, week)`);
      }
      return { key: col.key, title: col.title || col.key, type, required: !!col.required, unique: !!col.unique, editable: true,
               width: col.width || (type === 'uuid' ? 290 : type === 'text' || type === 'select' ? 240 : type === 'date' ? 150 : 120),
               mono: col.mono ?? type === 'uuid', trim: col.trim ?? type !== 'text', ...extra };
    });
    const idColumn = def.idColumn === null ? null
      : def.idColumn || (columns.find((c) => c.type === 'uuid') || {}).key || null;
    if (idColumn && !keys.has(idColumn)) throw new Error(`idColumn "${idColumn}" tidak ada di columns`);
    const options = (def.options || []).map((o) => {
      if (!o || !o.key || o.key in BASE || o.key === '_v') throw new Error(`opsi tidak valid: ${JSON.stringify(o)} (key wajib, bukan "jeda"/"backup"/"remark")`);
      return { type: 'checkbox', ...o, label: o.label || o.key };
    });
    const remarks = (def.remarks || []).map((rm) => {
      const x = typeof rm === 'string' ? { dataKey: rm } : { ...rm };
      if (!x || !x.dataKey) throw new Error(`remark tidak valid: ${JSON.stringify(rm)} (dataKey wajib)`);
      x.key = x.key || `remark_${x.dataKey}`;
      if (String(x.key).startsWith('_')) throw new Error(`remark ${x.dataKey}: key tidak boleh diawali "_"`);
      if (keys.has(x.key)) throw new Error(`kolom ganda: ${x.key} (remark bentrok dengan kolom lain)`);
      keys.add(x.key);
      return { key: x.key, dataKey: String(x.dataKey), title: x.title || `remark ${x.dataKey}`, type: 'text', required: false,
               unique: false, editable: true, width: x.width || 260, mono: false, trim: true };
    });
    if (remarks.length && !idColumn) throw new Error('remarks butuh idColumn (assignment id) untuk FASIH.setComment');
    return { ...def, name: def.name || def.id, description: def.description || '', columns, idColumn, options, remarks };
  }

  function register(def) {
    if (running) throw new Error('OTOMASI_DC_BATCH sedang berjalan — tunggu selesai atau Stop dulu');
    if (def.id === 'koreksi-ntb-se2026-l-blok-ii' && def.remarkPolicyVersion !== 2) {
      throw new Error('Skrip NTB lama tidak mendukung aturan remark terbaru. Gunakan skrip bawaan extension versi terbaru.');
    }
    const m = normalize(def);
    if (sheet) { saveNow(); sheet.destroy(); sheet = null; }
    mod = m; regCount++;
    const defaults = Object.fromEntries(m.options.map((o) => [o.key, o.default ?? (o.type === 'checkbox' ? false : '')]));
    const saved = LS.get(K.settings(m.id), {});
    if (saved._v !== SETTINGS_V) { delete saved.backup; delete saved.remark; delete saved.jeda; }
    S = { ...BASE, ...defaults, ...saved, _v: SETTINGS_V };
    // Versi ini khusus batch BPS Jabar: remark selalu dikirim dan backup
    // generik disembunyikan dari alur operator.
    S.remark = true;
    S.backup = false;
    buildUI();
    console.log(`[OTOMASI_DC_BATCH] terdaftar: ${m.name} — kolom ${m.columns.map((c) => c.key).join(', ')}`);
    return m;
  }

  function unload() {
    if (running) return;
    if (sheet) { saveNow(); sheet.destroy(); sheet = null; }
    mod = null;
    LS.del(K.code);
    buildUI();
    msg('Script dilepas. Data sheet tetap tersimpan dan muncul lagi saat script yang sama di-import.');
  }

  /* ---------------- tampilan sesuai script ---------------- */
  const remarkOn = () => !!(mod && mod.remarks.length && S.remark);
  const inputCols = () => (remarkOn() ? [...mod.columns, ...mod.remarks] : mod.columns);

  function buildUI() {
    if (sheet) { saveNow(); sheet.destroy(); sheet = null; }
    const has = !!mod;
    headerSub();
    A('.toolbar').hidden = !has; A('.hint').hidden = !has; empty.hidden = has;
    $('[data-act="unload"]').hidden = !has;
    const saved = LS.get(K.code, null), chip = $('.script');
    chip.hidden = !(has && saved);
    if (has && saved) {
      chip.textContent = `📄 ${saved.name}`;
      chip.title = `${saved.name} — di-import ${new Date(saved.importedAt).toLocaleString()}`;
    }
    if (view === 'auto') progress(0, 0);
    if (!has) { if (view === 'auto') $('.summary').textContent = ''; return; }

    $('.opts').innerHTML = mod.options.map((o) => {
      const tip = o.hint ? ` title="${esc(o.hint)}"` : '';
      if (o.type === 'checkbox') return `<label${tip}><input type="checkbox" data-set="${esc(o.key)}"> ${esc(o.label)}</label>`;
      if (o.type === 'select') return `<label${tip}>${esc(o.label)} <select data-set="${esc(o.key)}">${(o.choices || []).map((c) => {
        const v = typeof c === 'object' ? c.value : c, l = typeof c === 'object' ? (c.label ?? c.value) : c;
        return `<option value="${esc(v)}">${esc(l)}</option>`;
      }).join('')}</select></label>`;
      return `<label${tip}>${esc(o.label)} <input type="${o.type === 'number' ? 'number' : 'text'}" data-set="${esc(o.key)}"></label>`;
    }).join('');
    root.querySelectorAll('[data-set]').forEach((inp) => {
      const v = S[inp.dataset.set];
      if (inp.type === 'checkbox') inp.checked = !!v; else inp.value = v ?? '';
    });
    const input = inputCols();
    A('.hint').innerHTML = `Klik sel <b>A1</b> lalu <kbd>Ctrl</kbd>+<kbd>V</kbd> dari Excel — ${input.length} kolom: ` +
      input.map((c) => `<b>${esc(c.title)}</b>${c.required ? '' : ' <i>(opsional)</i>'}`).join(', ') +
      `. Baris judul otomatis dilewati. Sel merah = tidak valid (arahkan kursor untuk alasannya). <kbd>Ctrl</kbd>+<kbd>C</kbd> menyalin hasil kembali ke Excel.` +
      (remarkOn() ? ` Remark yang terisi ditulis sebagai catatan per-pertanyaan setelah baris berhasil diproses.` : '');

    sheet = new FasihSheet(A('.grid'), {
      columns: [...input, ...RESULT_COLS],
      cellClass: (row, key, r) => {
        if (key === '_status') return STATUS_CLASS[row._status] || '';
        if (key === '_ket' && row._status === 'GAGAL') return 'err-text';
        return invalid.has(r) && invalid.get(r).has(key) ? 'invalid' : '';
      },
      cellTitle: (row, key, r) => (invalid.has(r) && invalid.get(r).has(key) ? `${key}: ${invalid.get(r).get(key)}` : ''),
      onChange: (changedRows) => {
        for (const r of changedRows) Object.assign(sheet.rows[r], { _status: '', _code: '', _ket: '' });   // isi berubah -> hasil lama basi
        summary(); save();
      },
    });
    sheet.setRows(LS.get(K.rows(mod.id), []).map((r) => ({ ...r, _status: ['ANTRI', 'PROSES…'].includes(r._status) ? '' : r._status })));
    summary(); sheet.render();
    if (!panel.hidden && view === 'auto') sheet.focus();
  }

  /* judul tetap "OTOMASI DC Extension"; di sampingnya nama script / file backup sesuai menu aktif */
  function headerSub() {
    const sub = $('.sub');
    if (view === 'auto') sub.innerHTML = mod ? `<b>${esc(mod.name)}</b>${mod.description ? ` — ${esc(mod.description)}` : ''}` : '';
    else sub.innerHTML = rfile ? `<b>📄 ${esc(rfile.name)}</b> — ${rfile.items.size} record` +
      (rfile.createdAt ? `, dibuat ${esc(new Date(rfile.createdAt).toLocaleString())}` : '') : '';
    sub.title = sub.textContent;
  }

  /* ---------------- simpan data sheet per script ---------------- */
  let saveTimer = null;
  function saveNow() {
    clearTimeout(saveTimer);
    if (!mod || !sheet) return;
    const keys = [...mod.columns, ...mod.remarks, ...RESULT_COLS].map((c) => c.key);   // remark tetap disimpan walau toggle mati
    LS.set(K.rows(mod.id), sheet.filled().map(({ row }) => Object.fromEntries(keys.map((k) => [k, row[k] ?? '']))));
    LS.set(K.settings(mod.id), S);
  }
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); };

  /* ---------------- validasi ---------------- */
  function itemOf(row) {
    return Object.fromEntries([...mod.columns, ...mod.remarks].map((c) => {
      const s = String(row[c.key] ?? '');
      if (c.type === 'number' || c.type === 'integer') return [c.key, s.trim() === '' ? null : Number(s.trim().replace(',', '.'))];
      return [c.key, s];
    }));
  }
  function validate() {
    invalid = new Map();
    const mark = (r, k, why) => { if (!invalid.has(r)) invalid.set(r, new Map()); if (!invalid.get(r).has(k)) invalid.get(r).set(k, why); };
    const seen = Object.fromEntries(mod.columns.filter((c) => c.unique).map((c) => [c.key, new Map()]));
    const items = [];
    for (const { r, row } of sheet.filled()) {
      for (const c of mod.columns) {
        const s = String(row[c.key] ?? '').trim();
        if (!s) { if (c.required) mark(r, c.key, 'wajib diisi'); continue; }
        if (c.type === 'uuid' && !UUID.test(s)) mark(r, c.key, 'bukan UUID');
        if (c.type === 'number' && !Number.isFinite(Number(s.replace(',', '.')))) mark(r, c.key, 'bukan angka');
        if (c.type === 'integer' && !/^-?\d+$/.test(s)) mark(r, c.key, 'bukan bilangan bulat');
        if (c.type === 'select') {
          const bad = (c.multiple ? FasihSheet.splitMulti(s) : [s]).filter((x) => !FasihSheet.matchChoice(c.choices, x));
          if (bad.length) mark(r, c.key, `"${bad.join('; ')}" tidak ada di pilihan (pilih dari dropdown)`);
        }
        if (c.type === 'date' && !DATE_RE[c.input].test(s)) mark(r, c.key, `format ${c.input === 'date' ? 'YYYY-MM-DD' : c.input === 'month' ? 'YYYY-MM' : c.input === 'time' ? 'HH:MM' : c.input === 'week' ? 'YYYY-Www' : 'YYYY-MM-DD HH:MM'}`);
        if (c.unique) {
          const k = s.toLowerCase(), m = seen[c.key];
          if (m.has(k)) { mark(r, c.key, `ganda dengan baris ${m.get(k) + 1}`); mark(m.get(k), c.key, `ganda dengan baris ${r + 1}`); }
          else m.set(k, r);
        }
      }
      const item = itemOf(row);
      if (mod.validateRow && !invalid.has(r)) {
        try {
          const e = mod.validateRow(item);
          if (typeof e === 'string' && e) mark(r, mod.columns[0].key, e);
          else if (e && typeof e === 'object') for (const [k, why] of Object.entries(e)) if (why) mark(r, [...mod.columns, ...mod.remarks].some((c) => c.key === k) ? k : mod.columns[0].key, String(why));
        } catch (e) { mark(r, mod.columns[0].key, `validateRow error: ${e.message}`); }
      }
      items.push({ r, item });
    }
    return { items: items.filter((x) => !invalid.has(x.r)), bad: invalid.size, total: items.length };
  }
  function summary() {
    if (!mod || !sheet) return;
    const v = validate(), cnt = {};
    for (const { row } of sheet.filled()) if (row._status) cnt[row._status] = (cnt[row._status] || 0) + 1;
    const parts = [`${v.total} baris`, `${v.items.length} valid`];
    if (v.bad) parts.push(`${v.bad} tidak valid`);
    const st = Object.keys(cnt).filter((k) => !['ANTRI', 'PROSES…'].includes(k)).map((k) => `${k} ${cnt[k]}`);
    if (view === 'auto') $('.summary').textContent = parts.join(' · ') + (st.length ? '  |  ' + st.join(' · ') : '');
    return v;
  }

  /* ---------------- persetujuan assignment lewat UI FASIH ----------------
     Update nilai di script ini dikirim melalui API FASIH. Persetujuan adalah
     aksi status yang hanya tersedia pada halaman review, sehingga dilakukan
     melalui tombol UI FASIH dan diverifikasi dengan munculnya tombol Revoke.
     Antrean disimpan di localStorage agar dapat lanjut setelah halaman pindah. */
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isShown = (el) => !!(el && el.isConnected && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const actionButtons = (icon) => [...document.querySelectorAll('button')]
    .filter((button) => isShown(button) && !button.disabled && button.querySelector(`svg.${icon}`));
  const currentAssignment = () => {
    // FASIH kadang menambahkan segmen halaman (mis. review/edit) setelah ID.
    // Prefix dan assignment ID tetap dua segmen pertama yang diperlukan antrean.
    const m = location.pathname.match(/^\/app\/assignment\/([^/?#]+)\/([0-9a-f-]{36})(?:\/.*)?$/i);
    return m ? { prefix: `/app/assignment/${m[1]}/`, id: m[2] } : null;
  };
  async function waitForStatusButton(timeoutMs = 30000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const approve = actionButtons('tabler-icon-check');
      const revoke = actionButtons('tabler-icon-rotate-clockwise');
      if ((approve.length === 1 && revoke.length === 0) || (approve.length === 0 && revoke.length === 1)) return { approve, revoke };
      await wait(250);
    }
    throw new Error('tombol Approve atau Revoke tidak ditemukan dalam 30 detik');
  }
  async function approveCurrentAssignment() {
    const buttons = await waitForStatusButton();
    if (buttons.revoke.length === 1) return 'sudah approved';
    buttons.approve[0].click();
    const until = Date.now() + 15000;
    let dialog = null;
    while (Date.now() < until) {
      dialog = [...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')]
        .find((el) => isShown(el) && /Approve Assignment/i.test(el.textContent || ''));
      if (dialog) break;
      await wait(150);
    }
    if (!dialog) throw new Error('dialog konfirmasi Approve Assignment tidak muncul');
    const confirmButton = [...dialog.querySelectorAll('button')]
      .find((button) => isShown(button) && !button.disabled && button.textContent.trim() === 'Konfirmasi');
    if (!confirmButton) throw new Error('tombol Konfirmasi approve tidak ditemukan');
    confirmButton.click();
    const verifyUntil = Date.now() + 30000;
    while (Date.now() < verifyUntil) {
      const verified = await waitForStatusButton(1000).catch(() => null);
      if (verified && verified.revoke.length === 1 && verified.approve.length === 0) return 'approved';
      await wait(250);
    }
    throw new Error('Approve belum terverifikasi: tombol Revoke tidak muncul');
  }
  function rowByAssignment(id) {
    if (!sheet || !mod || !mod.idColumn) return null;
    return sheet.filled().find(({ row }) => String(row[mod.idColumn] || '').toLowerCase() === String(id).toLowerCase()) || null;
  }
  function stopApproval(message = 'Antrean approve dihentikan.') {
    const queue = LS.get(K.approval, null);
    if (queue) { queue.active = false; LS.set(K.approval, queue); }
    msg(message);
  }
  async function resumeApprovalQueue() {
    const queue = LS.get(K.approval, null);
    if (!queue || !queue.active) return;
    const here = currentAssignment();
    const id = queue.ids[queue.index];
    if (!id) { LS.del(K.approval); msg('Approve selesai dan telah diverifikasi dari tombol Revoke.'); return; }
    if (!here || here.id.toLowerCase() !== id.toLowerCase()) {
      if (!queue.prefix) return stopApproval('Approve dihentikan: buka dahulu satu halaman assignment FASIH, lalu mulai lagi.');
      location.assign(location.origin + queue.prefix + id);
      return;
    }
    try {
      msg(`Approve ${queue.index + 1}/${queue.ids.length} — ${id}`);
      const outcome = await approveCurrentAssignment();
      const found = rowByAssignment(id);
      if (found) {
        const old = String(found.row._ket || '');
        setStatus(found.r, 'APPROVED', found.row._code, [old, outcome].filter(Boolean).join(' · '));
        saveNow();
      }
      queue.index += 1; LS.set(K.approval, queue);
      if (queue.index >= queue.ids.length) { LS.del(K.approval); msg('Approve selesai dan telah diverifikasi dari tombol Revoke.'); return; }
      await wait(Math.max(1000, Number(queue.delayMs) || 3000));
      location.assign(location.origin + queue.prefix + queue.ids[queue.index]);
    } catch (e) {
      const found = rowByAssignment(id);
      if (found) { setStatus(found.r, 'GAGAL APPROVE', found.row._code, [found.row._ket, 'approve GAGAL: ' + errText(e)].filter(Boolean).join(' · ')); saveNow(); }
      stopApproval(`Approve dihentikan pada ${id}: ${errText(e)}. Periksa assignment ini sebelum melanjutkan.`);
      console.error('[OTOMASI_DC_BATCH] approve gagal', e);
    }
  }
  function startApprovalQueue() {
    if (running || !sheet || !mod) return;
    if (sheet.edit) sheet.commitEdit();
    const route = currentAssignment();
    if (!route) return msg('Buka satu halaman assignment FASIH terlebih dahulu, lalu klik Approve hasil LIVE.', 'err');
    // SELESAI berarti nilai dan remark sudah ada, tetapi status assignment
    // belum tentu approved. Keduanya harus masuk antrean persetujuan.
    const ids = [...new Set(sheet.filled().filter(({ row }) => ['OK', 'SELESAI', 'SUDAH_DIKERJAKAN'].includes(row._status))
      .map(({ row }) => String(row[mod.idColumn] || '').trim()).filter(Boolean))];
    if (!ids.length) return msg('Tidak ada baris status OK atau SUDAH_DIKERJAKAN untuk di-approve.', 'err');
    if (!confirm(`Approve ${ids.length} assignment hasil LIVE?\n\nExtension akan membuka setiap assignment, menekan Approve hanya jika tombol Approve tersedia, lalu memastikan tombol Revoke muncul. Antrean berhenti pada error pertama.`)) return;
    LS.set(K.approval, { active: true, prefix: route.prefix, ids, index: 0, delayMs: Math.max(3000, Number(S.jeda) || 0), createdAt: new Date().toISOString() });
    resumeApprovalQueue();
  }

  /* ---------------- proses ---------------- */
  function setStatus(r, status, code, ket) {
    const row = sheet.rows[r];
    row._status = status;
    if (code !== undefined) row._code = code == null ? '' : String(code);
    if (ket !== undefined) row._ket = ket == null ? '' : String(ket);
    sheet.renderRow(r);
  }
  function setRunning(on) {
    running = on; if (sheet) sheet.locked = on; if (rsheet) rsheet.locked = on;
    root.querySelectorAll('[data-act="loadcsv"],[data-act="dry"],[data-act="live"],[data-act="approve"],[data-act="clear"],[data-act="resetStatus"],[data-act="import"],[data-act="unload"],[data-set],' +
      '[data-act="rfile"],[data-act="rdry"],[data-act="rlive"],[data-act="rresetStatus"],[data-act="rclose"],[data-rset],[data-view]')
      .forEach((b) => { b.disabled = on; });
    root.querySelectorAll('[data-act="stop"],[data-act="rstop"]').forEach((b) => { b.disabled = !on; });
  }
  const sleep = async (ms) => { const end = Date.now() + ms; while (!abort && Date.now() < end) await new Promise((r) => setTimeout(r, Math.min(200, end - Date.now()))); };
  const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const errText = (e) => String((e && e.message) || e);
  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  function exportResults() {
    if (!sheet || !mod) return msg('Belum ada antrean untuk diunduh.', 'err');
    if (sheet.edit) sheet.commitEdit();
    const cols = [...mod.columns, ...mod.remarks, ...RESULT_COLS];
    const data = [cols.map((col) => col.key)];
    for (const { row } of sheet.filled()) data.push(cols.map((col) => row[col.key] ?? ''));
    const csv = data.map((line) => line.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url;
    link.download = `hasil-otomasi-dc-extension-${stamp()}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    msg('Hasil diunduh. Gunakan untuk rekonsiliasi status database pusat.');
  }

  /* CSV batch dibuat oleh siapkan_tsv_ntb.py: tanpa judul kolom dan urutannya
     sama dengan kolom skrip. Parser menangani koma, kutip, dan baris baru
     dalam sel agar nilai/remark tidak bergeser. */
  function parseCsv(text) {
    const rows = [], row = [];
    let cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row.splice(0)); cell = ''; }
      else cell += c;
    }
    if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
    return rows.filter((line) => line.some((value) => String(value).trim() !== ''));
  }

  async function loadBatchCsv(file) {
    if (!file || running || !mod) return;
    try {
      if (sheet.edit) sheet.commitEdit();
      const expected = [...mod.columns, ...mod.remarks];
      const raw = parseCsv((await file.text()).replace(/^\uFEFF/, ''));
      const start = raw[0]?.[0] === 'assignment_id' ? 1 : 0;
      const values = raw.slice(start);
      if (!values.length) throw new Error('file CSV tidak memiliki baris data');
      const wrong = values.findIndex((line) => line.length !== expected.length);
      if (wrong >= 0) throw new Error(`baris ${wrong + start + 1} memiliki ${values[wrong].length} kolom; seharusnya ${expected.length}. Gunakan CSV hasil siapkan_tsv_ntb.py.`);
      const rows = values.map((line) => {
        const item = Object.fromEntries(expected.map((col, i) => [col.key, line[i] ?? '']));
        return mod.id === 'koreksi-ntb-se2026-l-blok-ii'
          ? window.OTOMASI_DC_REMARK_POLICY.normalize(item, mod.remarks) : item;
      });
      sheet.setRows(rows);
      summary(); sheet.render(); saveNow();
      msg(`${rows.length} baris dimuat dari ${file.name}. Jalankan Dry run sebelum LIVE.`);
    } catch (e) {
      msg('Gagal memuat CSV: ' + errText(e), 'err');
    }
  }

  /* remark terisi di satu baris sheet: [{ dataKey, text }] */
  const remarksOf = (row) => mod.remarks
    .map((rm) => ({ dataKey: rm.dataKey, text: String(row[rm.key] ?? '').trim() }))
    .filter((x) => x.text);

  async function retry429(action, label) {
    const waits = [5000, 15000, 30000];
    for (let attempt = 0; attempt <= waits.length; attempt++) {
      try { return await action(); }
      catch (error) {
        const rateLimited = /(?:\b429\b|too many requests)/i.test(errText(error));
        if (!rateLimited || attempt === waits.length || abort) throw error;
        const ms = waits[attempt];
        msg(`${label}: server membatasi permintaan. Menunggu ${Math.round(ms / 1000)} detik lalu mencoba lagi (${attempt + 1}/${waits.length})…`, 'err');
        await sleep(ms);
      }
    }
  }

  /* Tulis seluruh remark yang belum ada dalam satu submit comment. Teks yang sudah ada
     persis di dataKey yang sama dilewati supaya LIVE ulang tidak menggandakan catatan. */
  async function applyRemarks(id, list, dry, remarkKeys = null) {
    const asg = await retry429(() => F().getAssignment(id), 'Cek remark');
    let notes;
    try { notes = JSON.parse(asg.comment || '{}').notes || []; }
    catch { throw new Error('Remark FASIH tidak dapat dibaca; periksa manual.'); }
    if (!Array.isArray(notes)) throw new Error('Struktur remark FASIH tidak dikenali; periksa manual.');
    const missing = [];
    for (const rm of list) {
      const text = rm.text;
      const dataKey = (remarkKeys && remarkKeys[rm.dataKey]) || rm.dataKey;   // mis. nama_usaha -> nama_usaha#1001
      const ada = notes.some((n) => n && n.dataKey === dataKey && (n.comments || []).some((c) => c && c.comment === text));
      if (!ada) missing.push({ dataKey, text });
    }
    if (!missing.length) return list.map((rm) => (remarkKeys && remarkKeys[rm.dataKey]) || rm.dataKey).map((key) => `${key} (sudah ada)`);
    if (dry) return missing.map((rm) => rm.dataKey);
    const result = await retry429(() => F().setComments(id, missing, { dryRun: false }), 'Kirim remark');
    return missing.map((rm) => `${rm.dataKey} v${result.version} → v${result.versionAfter}`);
  }

  async function run(dry) {
    if (running || !mod) return;
    if (sheet.edit) sheet.commitEdit();
    const v = summary(); sheet.render();
    if (!v.total) return msg('Belum ada data — tempel dari Excel dulu.', 'err');
    if (v.bad) {
      const contoh = [...invalid.entries()].slice(0, 3)
        .map(([r, m]) => `baris ${r + 1}: ${[...m].map(([k, why]) => `${k} ${why}`).join(', ')}`).join('; ');
      return msg(`${v.bad} baris tidak valid — ${contoh}`, 'err');
    }
    const targets = dry ? v.items : v.items.filter((x) => !['OK', 'SELESAI', 'SUDAH_DIKERJAKAN', 'APPROVED'].includes(sheet.rows[x.r]._status));
    if (!targets.length) return msg('Semua baris sudah selesai/approved.');
    const withRemark = remarkOn();
    for (const x of targets) x.remarks = withRemark ? remarksOf(sheet.rows[x.r]) : [];
    if (!dry) {
      const belumDry = targets.filter((x) => sheet.rows[x.r]._status !== 'DRY RUN').length;
      const nRemark = targets.reduce((n, x) => n + x.remarks.length, 0);
      if (!confirm(`[${mod.name}]\nKirim perubahan LIVE untuk ${targets.length} baris?` +
        (nRemark ? `\nRemark: ${nRemark} sel terisi — ditulis lewat FASIH.setComment untuk baris yang berhasil.` : '') +
        (belumDry ? `\n\n⚠️ ${belumDry} baris belum lolos dry run.` : '') +
        `\n\nServer tidak memvalidasi isi dokumen — pastikan hasil dry run sudah diperiksa.`)) return;
    }

    const m = mod, rows = targets.map((x) => x.item);
    const ctx = { dryRun: dry, options: { ...S }, FASIH: F(), sleep, total: targets.length };
    abort = false; setRunning(true);
    targets.forEach((x) => setStatus(x.r, 'ANTRI'));
    const results = [];
    let done = 0;
    try {
      msg('Menyiapkan…');
      if (m.before) await m.before(rows, ctx);
      else if (m.idColumn) await F().init({ assignmentId: rows[0][m.idColumn] });
      if (withRemark && F()._internal.SCHEMA) {        // dataKey remark salah ketik -> hentikan sebelum ada yang dikirim
        const dipakai = new Set(targets.flatMap((x) => x.remarks.map((y) => y.dataKey)));
        const salah = [...dipakai].filter((k) => !F().schema(k));
        if (salah.length) throw new Error(`dataKey remark tidak ada di template: ${salah.join(', ')} — periksa "remarks" di script`);
      }
      if (!dry && S.backup && m.idColumn) {
        msg(`Membuat backup ${rows.length} record…`);
        const bak = await F().backup(rows.map((x) => x[m.idColumn]), `fasih-backup-${m.id}-${stamp()}.json`, backupOpts());
        progress(0, targets.length);
        if (!bak) return msg('Backup dihentikan — file tidak diunduh, tidak ada yang dikirim.');
      }
      for (let i = 0; i < targets.length && !abort; i++) {
        const { r, item, remarks } = targets[i];
        setStatus(r, 'PROSES…');
        msg(`${dry ? 'Dry run' : 'LIVE'} ${i + 1}/${targets.length}${m.idColumn ? ` — ${item[m.idColumn]}` : ''}`);
        try {
          const res = (await retry429(() => m.process(item, { ...ctx, index: i, rowNumber: r + 1, remarks }), 'Proses assignment')) || {};
          let status = res.status || (res.skip ? 'LEWATI' : dry ? 'DRY RUN' : 'OK'), ket = res.ket;
          if (remarks.length && !res.skip && status !== 'GAGAL') {
            try {
              const done = await applyRemarks(item[m.idColumn], remarks, dry, res.remarkKeys);
              ket = [ket, `remark: ${done.join(', ')}`].filter(Boolean).join(' · ');
            } catch (e) {
              status = 'GAGAL';
              ket = [ket, `${dry ? '' : 'data sudah diproses, '}remark GAGAL: ${errText(e)}`].filter(Boolean).join(' · ');
              console.warn(`[OTOMASI_DC_BATCH] ${i + 1}/${targets.length} remark GAGAL`, item, e);
            }
          }
          setStatus(r, status, res.code, ket);
          results.push({ row: r + 1, item, remarks, status, result: res });
          console.log(`[OTOMASI_DC_BATCH] ${i + 1}/${targets.length} ${status}`, item, res);
        } catch (e) {
          setStatus(r, 'GAGAL', undefined, errText(e));
          results.push({ row: r + 1, item, status: 'GAGAL', error: errText(e) });
          console.warn(`[OTOMASI_DC_BATCH] ${i + 1}/${targets.length} GAGAL`, item, e);
        }
        done = i + 1; progress(done, targets.length); summary(); save();
        if (i < targets.length - 1) await sleep(S.jeda);
      }
      if (m.after) await m.after(results, ctx);
      msg(abort ? `Dihentikan setelah ${done}/${targets.length}.`
                : `${dry ? 'Dry run' : 'LIVE'} selesai — ${done} baris diproses.${dry ? ' Periksa hasilnya, lalu Jalankan LIVE.' : ''}`);
    } catch (e) {
      msg('Gagal: ' + errText(e), 'err');
      console.error('[OTOMASI_DC_BATCH]', e);
    } finally {
      for (const { r } of targets) if (['ANTRI', 'PROSES…'].includes(sheet.rows[r]._status)) setStatus(r, '');
      setRunning(false); summary(); saveNow();
    }
  }

  /* ---------------- menu Restore: kembalikan assignment ke isi file backup ----------------
     File backup tidak disimpan di localStorage (bisa beberapa MB) — reload halaman = pilih file lagi.
     Sebelum restore, isi backup dibandingkan dengan kondisi sekarang; record yang sudah sama
     tidak dikirim (LEWATI) supaya versinya tidak naik percuma. */
  const RBASE = { jeda: 1500, backup: false };
  const RS = (() => {
    const saved = LS.get(K.restore, {});
    if (saved._v !== SETTINGS_V) delete saved.backup;      // pengaturan versi lama selalu menyimpan backup: true (default lama)
    return { ...RBASE, ...saved, _v: SETTINGS_V };
  })();
  const RCOLS = [
    { key: 'assignment_id', title: 'assignment_id', width: 290, editable: true, mono: true, trim: true },
    { key: 'code', title: 'code_identity (backup)', width: 210, mono: true },
    { key: 'versi', title: 'versi backup', width: 95 },
    { key: 'jawaban', title: 'jawaban', width: 75 },
    { key: '_status', title: 'status', width: 90 },
    { key: '_ver', title: 'versi', width: 150, mono: true },
    { key: '_ket', title: 'keterangan', width: 520 },
  ];
  const rItem = (id) => (rfile && rfile.items.get(String(id ?? '').trim().toLowerCase())) || null;
  function rfill(row) {                                   // kolom read-only diambil dari file backup berdasarkan assignment_id
    const it = rItem(row.assignment_id);
    return Object.assign(row, { code: it ? it.code ?? '' : '', versi: it ? String(it.submit_version_code ?? '') : '', jawaban: it ? String(it.n) : '' });
  }

  function rbuild() {
    if (!rsheet) {
      rsheet = new FasihSheet(R('.grid'), {
        columns: RCOLS,
        cellClass: (row, key, r) => {
          if (key === '_status') return STATUS_CLASS[row._status] || '';
          if (key === '_ket' && row._status === 'GAGAL') return 'err-text';
          return key === 'assignment_id' && rinvalid.has(r) ? 'invalid' : '';
        },
        cellTitle: (row, key, r) => (key === 'assignment_id' && rinvalid.has(r) ? `assignment_id: ${rinvalid.get(r)}` : ''),
        onChange: (changedRows) => {
          for (const r of changedRows) Object.assign(rfill(rsheet.rows[r]), { _status: '', _ver: '', _ket: '' });
          rsummary();
        },
      });
    }
    const has = !!rfile;
    R('.toolbar').hidden = !has; R('.hint').hidden = !has; R('.empty').hidden = has; rsheet.el.hidden = !has;
    root.querySelectorAll('[data-rset]').forEach((inp) => {
      const v = RS[inp.dataset.rset];
      if (inp.type === 'checkbox') inp.checked = !!v; else inp.value = v ?? '';
    });
    R('.hint').innerHTML = `Semua assignment di file dimuat. Untuk restore sebagian: pilih sel <b>assignment_id</b> yang tidak perlu lalu <kbd>Delete</kbd>, ` +
      `atau <kbd>Ctrl</kbd>+<kbd>A</kbd> → <kbd>Delete</kbd> lalu tempel daftar assignment_id dari Excel. ` +
      `Restore menimpa <b>jawaban, catatan, dan kolom data1–data10</b> dengan isi backup — perubahan setelah backup dibuat akan hilang. ` +
      `Record yang sudah sama dengan backup dilewati.`;
    headerSub();
    if (view === 'restore') { rsummary(); rsheet.render(); if (!panel.hidden && has) rsheet.focus(); }
  }

  function rvalidate() {
    rinvalid = new Map();
    const seen = new Map(), items = [];
    for (const { r, row } of rsheet.filled()) {
      const id = String(row.assignment_id).trim(), k = id.toLowerCase();
      const why = !UUID.test(id) ? 'bukan UUID' : !rItem(id) ? 'tidak ada di file backup'
        : seen.has(k) ? `ganda dengan baris ${seen.get(k) + 1}` : '';
      if (why) rinvalid.set(r, why);
      else { seen.set(k, r); items.push({ r, it: rItem(id) }); }
    }
    return { items, bad: rinvalid.size, total: items.length + rinvalid.size };
  }
  function rsummary() {
    if (!rsheet || !rfile) { if (view === 'restore') $('.summary').textContent = ''; return null; }
    const v = rvalidate(), cnt = {};
    for (const { row } of rsheet.filled()) if (row._status) cnt[row._status] = (cnt[row._status] || 0) + 1;
    const parts = [`${v.total} baris`, `${v.items.length} valid`];
    if (v.bad) parts.push(`${v.bad} tidak valid`);
    const st = Object.keys(cnt).filter((k) => !['ANTRI', 'PROSES…'].includes(k)).map((k) => `${k} ${cnt[k]}`);
    if (view === 'restore') $('.summary').textContent = parts.join(' · ') + (st.length ? '  |  ' + st.join(' · ') : '');
    return v;
  }

  async function loadBackup(file) {
    if (!file || running) return;
    try {
      msg(`Membaca ${file.name}…`);
      let j;
      try { j = JSON.parse(await file.text()); } catch (e) { throw new Error(`bukan JSON yang valid (${e.message})`); }
      const list = Array.isArray(j) ? j : j && j.items;
      if (!Array.isArray(list) || !list.length) throw new Error('bukan file backup FASIH — tidak ada "items"');
      const items = new Map();
      let ganda = 0;
      list.forEach((it, i) => {
        const id = String((it && it.assignmentId) || '');
        if (!UUID.test(id)) throw new Error(`item ${i + 1}: assignmentId tidak valid`);
        let n;
        try { n = JSON.parse(it.data).answers.length; } catch { throw new Error(`item ${i + 1} (${id}): "data" bukan dokumen FASIH`); }
        if (items.has(id.toLowerCase())) { ganda++; return; }      // backup diambil sebelum diubah -> isi kembarannya sama
        items.set(id.toLowerCase(), { ...it, n });
      });
      rfile = { name: file.name, createdAt: Array.isArray(j) ? null : j.createdAt || null, items };
      rbuild();
      rsheet.setRows([...items.values()].map((it) => rfill({ assignment_id: it.assignmentId })));
      progress(0, 0); rsummary();
      msg(`${file.name} dimuat — ${items.size} assignment${ganda ? ` (${ganda} duplikat diabaikan)` : ''}. Klik Dry run untuk melihat apa yang akan dikembalikan.`);
    } catch (e) {
      msg(`Gagal membaca ${file.name}: ${errText(e)}`, 'err');
      console.error('[OTOMASI_DC_BATCH] restore', e);
    }
  }
  const backupInput = $('.f-backup');
  backupInput.addEventListener('change', () => { loadBackup(backupInput.files[0]); backupInput.value = ''; });

  /* beda isi backup vs kondisi sekarang (dari sudut pandang restore) */
  const colVal = (v) => (v == null ? '' : String(v));
  function diffBackup(it, asg) {
    const map = (data) => new Map(JSON.parse(data).answers.map((a) => [a.dataKey, JSON.stringify(a.answer)]));
    const now = map(asg.data), old = map(it.data);
    let ubah = 0, kembali = 0, hapus = 0;
    for (const [k, v] of old) if (!now.has(k)) kembali++; else if (now.get(k) !== v) ubah++;
    for (const k of now.keys()) if (!old.has(k)) hapus++;
    const kolom = Object.keys(it.columns || {}).filter((k) => colVal(it.columns[k]) !== colVal(asg[k]));
    const catatan = it.comment != null && it.comment !== asg.comment;
    const text = [ubah && `${ubah} jawaban berubah`, kembali && `${kembali} jawaban dikembalikan`, hapus && `${hapus} jawaban dihapus`,
                  kolom.length && `kolom ${kolom.join(', ')}`, catatan && 'catatan'].filter(Boolean).join(', ');
    return { total: ubah + kembali + hapus + kolom.length + (catatan ? 1 : 0), text };
  }

  async function restoreOne(it, dry) {
    const asg = await F().getAssignment(it.assignmentId);
    if (it.survey_period_id && asg.survey_period_id && it.survey_period_id !== asg.survey_period_id)
      throw new Error(`survey period berbeda (backup ${it.survey_period_id}, sekarang ${asg.survey_period_id})`);
    const d = diffBackup(it, asg), ver = `v${asg.submit_version_code} (backup v${it.submit_version_code})`;
    if (!d.total) return { status: 'LEWATI', ver, ket: 'sudah sama dengan backup' };
    if (dry) return { status: 'DRY RUN', ver, ket: d.text };
    const [res] = await F().restore([it], { dryRun: false, delayMs: 0 });
    if (!res || res.ok === false) throw new Error((res && res.error) || 'restore gagal');
    return { status: 'OK', ver: `v${res.version} → v${res.versionAfter}`, ket: `dikembalikan: ${d.text}` };
  }

  function rsetStatus(r, status, ver, ket) {
    const row = rsheet.rows[r];
    row._status = status;
    if (ver !== undefined) row._ver = ver == null ? '' : String(ver);
    if (ket !== undefined) row._ket = ket == null ? '' : String(ket);
    rsheet.renderRow(r);
  }

  async function runRestore(dry) {
    if (running || !rfile) return;
    if (rsheet.edit) rsheet.commitEdit();
    const v = rsummary(); rsheet.render();
    if (!v.total) return msg('Tidak ada assignment_id untuk direstore.', 'err');
    if (v.bad) {
      const contoh = [...rinvalid].slice(0, 3).map(([r, why]) => `baris ${r + 1}: ${why}`).join('; ');
      return msg(`${v.bad} baris tidak valid — ${contoh}`, 'err');
    }
    const targets = dry ? v.items : v.items.filter((x) => rsheet.rows[x.r]._status !== 'OK');
    if (!targets.length) return msg('Semua baris sudah selesai/approved.');
    if (!dry) {
      const belumDry = targets.filter((x) => !['DRY RUN', 'LEWATI'].includes(rsheet.rows[x.r]._status)).length;
      if (!confirm(`[Restore] ${rfile.name}\nKembalikan ${targets.length} assignment ke isi backup (jawaban, catatan, kolom data1–data10)?` +
        `\n\nPerubahan apa pun setelah backup dibuat akan TERTIMPA.` +
        (belumDry ? `\n⚠️ ${belumDry} baris belum lolos dry run.` : '') +
        (RS.backup ? '' : `\n⚠️ "Backup kondisi sekarang" tidak dicentang — restore ini tidak bisa dibatalkan.`))) return;
    }

    abort = false; setRunning(true);
    targets.forEach((x) => rsetStatus(x.r, 'ANTRI'));
    let done = 0;
    try {
      if (!dry && RS.backup) {
        msg(`Membuat backup kondisi sekarang ${targets.length} record…`);
        const bak = await F().backup(targets.map((x) => x.it.assignmentId), `fasih-backup-sebelum-restore-${stamp()}.json`, backupOpts());
        progress(0, targets.length);
        if (!bak) return msg('Backup dihentikan — file tidak diunduh, tidak ada yang di-restore.');
      }
      for (let i = 0; i < targets.length && !abort; i++) {
        const { r, it } = targets[i];
        rsetStatus(r, 'PROSES…');
        msg(`${dry ? 'Dry run' : 'Restore'} ${i + 1}/${targets.length} — ${it.assignmentId}`);
        try {
          const res = await restoreOne(it, dry);
          rsetStatus(r, res.status, res.ver, res.ket);
          console.log(`[OTOMASI_DC_BATCH] restore ${i + 1}/${targets.length} ${res.status}`, it.assignmentId, res);
        } catch (e) {
          rsetStatus(r, 'GAGAL', undefined, errText(e));
          console.warn(`[OTOMASI_DC_BATCH] restore ${i + 1}/${targets.length} GAGAL`, it.assignmentId, e);
        }
        done = i + 1; progress(done, targets.length); rsummary();
        if (i < targets.length - 1) await sleep(RS.jeda);
      }
      msg(abort ? `Dihentikan setelah ${done}/${targets.length}.`
                : `${dry ? 'Dry run' : 'Restore'} selesai — ${done} baris diproses.${dry ? ' Periksa hasilnya, lalu Restore LIVE.' : ''}`);
    } catch (e) {
      msg('Gagal: ' + errText(e), 'err');
      console.error('[OTOMASI_DC_BATCH] restore', e);
    } finally {
      for (const { r } of targets) if (['ANTRI', 'PROSES…'].includes(rsheet.rows[r]._status)) rsetStatus(r, '');
      setRunning(false); rsummary();
    }
  }

  /* ---------------- pindah menu ---------------- */
  function setView(v) {
    if (running) return;
    if (sheet && sheet.edit) sheet.commitEdit();
    if (rsheet && rsheet.edit) rsheet.commitEdit();
    view = v === 'restore' || v === 'auto' ? v : 'custom';
    root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    $('.v-auto').hidden = view !== 'auto'; $('.v-restore').hidden = view !== 'restore'; $('.hdr-auto').hidden = view !== 'auto';
    $('.v-custom').hidden = view !== 'custom';
    $('.summary').textContent = ''; progress(0, 0); msg('');
    if (view === 'custom') { headerSubCustom(); if (!panel.hidden) loadCustom(); }
    else if (view === 'restore') rbuild();
    else { headerSub(); if (sheet) { sheet.render(); summary(); if (!panel.hidden) sheet.focus(); } }
  }

  /* ---------------- menu Custom automation: FASIH Sheet (custom/sheet.html) ----------------
     Halaman pemuat dari extension dimasukkan sebagai srcdoc iframe: dokumen srcdoc mewarisi origin
     halaman FASIH, sehingga fetch ke /app/api/... memakai cookie login tanpa CORS, dan data sheet
     tersimpan di localStorage/IndexedDB origin FASIH. Dimuat saat menu ini pertama kali dibuka. */
  let customHtml = null, customFrame = null;
  function headerSubCustom() {
    $('.sub').innerHTML = '<b>FASIH Sheet</b> — import kuesioner HTML, lalu isi kolom assignment_id';
  }
  async function loadCustom(force = false) {
    if (customFrame && !force) return;
    try {
      if (!customHtml) {
        const { url } = await askBridge('custom-sheet-url', {}, 3000);
        const r = await fetch(url);
        if (!r.ok) throw new Error(`custom/sheet.html ${r.status}`);
        customHtml = await r.text();
      }
      if (!customFrame) {
        customFrame = document.createElement('iframe');
        customFrame.className = 'custom-frame';
        customFrame.title = 'Custom automation (FASIH Sheet)';
        $('.custom-box').replaceChildren(customFrame);
      }
      customFrame.srcdoc = `${customHtml}\n<!-- ${Date.now()} -->`;   // nilai baru -> iframe dimuat ulang
    } catch (e) {
      msg(`Gagal memuat Custom automation: ${errText(e)}`, 'err');
    }
  }

  /* ---------------- import script ---------------- */
  let bridgeSeq = 0;
  function askBridge(type, payload = {}, timeoutMs = 8000) {      // minta bridge.js (punya akses chrome.runtime)
    return new Promise((resolve, reject) => {
      const id = ++bridgeSeq;
      const t = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('extension tidak merespons')); }, timeoutMs);
      function on(e) {
        if (e.source !== window || !e.data || e.data.__fasihBatch !== `${type}-result` || e.data.id !== id) return;
        clearTimeout(t); window.removeEventListener('message', on);
        e.data.ok ? resolve(e.data) : reject(new Error(e.data.error || `${type} gagal`));
      }
      window.addEventListener('message', on);
      window.postMessage({ __fasihBatch: type, id, ...payload }, '*');
    });
  }
  /* CSP menolak eval -> minta background menjalankan lewat chrome.userScripts */
  const viaExtension = (code) => askBridge('exec', { code });

  /* Template batch-automation.js ada di extension (web_accessible_resources) */
  async function downloadTemplate() {
    try {
      const { url } = await askBridge('template-url', {}, 3000);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`template ${r.status}`);
      const blob = new Blob([await r.text()], { type: 'text/javascript' });
      const u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = 'batch-automation.js';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
      msg('Template diunduh sebagai batch-automation.js — ubah bagian TODO, lalu Import script.');
    } catch (e) {
      msg(`Gagal mengunduh template: ${errText(e)}`, 'err');
    }
  }
  let lastLoadError = null;
  async function runCode(code, name) {
    const before = regCount;
    const tag = `\n//# sourceURL=otomasi-dc-ext:///${String(name).replace(/[^\w.\- ]/g, '_')}`;
    let fn = null;
    try { fn = new AsyncFunction('FASIH', 'OTOMASI_DC_BATCH', code + tag); }
    catch (e) {
      if (e instanceof SyntaxError) throw new Error(`syntax error di ${name}: ${e.message}`);
      console.warn('[OTOMASI_DC_BATCH] eval ditolak CSP halaman, mencoba lewat chrome.userScripts:', e.message);
    }
    if (fn) await fn(F(), window.OTOMASI_DC_BATCH);
    else {
      lastLoadError = null;
      await viaExtension(`(async function (OTOMASI_DC_BATCH) {\n${code}\n}).call(window, window.OTOMASI_DC_BATCH)` +
        `.catch((e) => window.postMessage({ __fasihBatch: 'load-error', error: String((e && e.message) || e) }, '*'));${tag}`);
      for (let i = 0; i < 40 && regCount === before && !lastLoadError; i++) await new Promise((r) => setTimeout(r, 100));
      if (lastLoadError) throw new Error(lastLoadError);
    }
    if (regCount === before) throw new Error(`${name} tidak memanggil OTOMASI_DC_BATCH.register({...})`);
  }
  async function importFile(file) {
    if (!file || running) return;
    const prev = LS.get(K.code, null), modBefore = mod;
    try {
      const code = await file.text();
      msg(`Memuat ${file.name}…`);
      LS.set(K.code, { name: file.name, code, importedAt: new Date().toISOString() });   // disimpan dulu supaya chip nama file benar
      await runCode(code, file.name);
      msg(`${file.name} dimuat — ${mod.name}.`);
    } catch (e) {
      msg(`Gagal import ${file.name}: ${errText(e)}`, 'err');
      console.error('[OTOMASI_DC_BATCH]', e);
      if (mod === modBefore) { if (prev) LS.set(K.code, prev); else LS.del(K.code); buildUI(); }   // script lama tetap aktif
    }
  }
  fileInput.addEventListener('change', () => { importFile(fileInput.files[0]); fileInput.value = ''; });
  dataInput.addEventListener('change', () => { loadBatchCsv(dataInput.files[0]); dataInput.value = ''; });

  /* ---------------- tombol & pengaturan ---------------- */
  const toggle = (show = panel.hidden) => {
    panel.hidden = !show; fab.hidden = show;
    if (!show) return;
    if (view === 'custom') { loadCustom(); customFrame?.focus(); }
    else if (view === 'restore') { if (rsheet && rfile) { rsheet.render(); rsummary(); rsheet.focus(); } }
    else if (sheet) { sheet.render(); summary(); sheet.focus(); }
  };
  fab.addEventListener('click', () => toggle(true));
  root.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-view]');
    if (nav && !nav.disabled) return setView(nav.dataset.view);
    const act = e.target.closest('[data-act]');
    if (!act || act.disabled) return;
    const a = act.dataset.act;
    if (a === 'close') toggle(false);
    else if (a === 'rfile') backupInput.click();
    else if (a === 'rdry') runRestore(true);
    else if (a === 'rlive') runRestore(false);
    else if (a === 'rstop') { abort = true; msg('Menghentikan setelah baris yang sedang diproses…'); }
    else if (a === 'rresetStatus') {
      for (const { row } of rsheet.filled()) Object.assign(row, { _status: '', _ver: '', _ket: '' });
      rsheet.render(); rsummary(); progress(0, 0); msg('');
    } else if (a === 'rclose') {
      if (rsheet.filled().some(({ row }) => row._status) && !confirm('Tutup file backup? Kolom status hasil restore ikut hilang.')) return;
      rfile = null; rsheet.setRows([]); rbuild(); progress(0, 0); msg('');
    }
    else if (a === 'import') fileInput.click();
    else if (a === 'loadcsv') dataInput.click();
    else if (a === 'template') downloadTemplate();
    else if (a === 'unload') { if (confirm('Lepas script ini?')) unload(); }
    else if (a === 'dry') run(true);
    else if (a === 'live') run(false);
    else if (a === 'approve') startApprovalQueue();
    else if (a === 'stopapprove') stopApproval('Antrean approve dihentikan.');
    else if (a === 'stop') { abort = true; msg('Menghentikan setelah baris yang sedang diproses…'); }
    else if (a === 'export') exportResults();
    else if (a === 'resetStatus') {
      for (const { row } of sheet.filled()) Object.assign(row, { _status: '', _code: '', _ket: '' });
      sheet.render(); summary(); save(); progress(0, 0); msg('');
    } else if (a === 'clear') {
      if (sheet.filled().length && !confirm('Kosongkan semua baris?')) return;
      sheet.setRows([]); summary(); save(); progress(0, 0); msg('');
    }
  });
  root.addEventListener('change', (e) => {
    const rinp = e.target.closest && e.target.closest('[data-rset]');
    if (rinp) {
      RS[rinp.dataset.rset] = rinp.type === 'checkbox' ? rinp.checked : Math.max(0, Number(rinp.value) || 0);
      return LS.set(K.restore, RS);
    }
    const inp = e.target.closest && e.target.closest('[data-set]');
    if (!inp) return;
    const k = inp.dataset.set;
    S[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Math.max(0, Number(inp.value) || 0) : inp.value;
    if (k === 'remark') {                                   // kolom remark muncul/hilang -> bangun ulang sheet
      if (sheet && sheet.edit) sheet.commitEdit();
      buildUI();
      msg(S.remark ? `Remark aktif — kolom ${mod.remarks.map((x) => x.title).join(', ')} ditambahkan.` : 'Remark nonaktif — isi kolom remark tetap tersimpan.');
    } else save();
  });
  ['keydown', 'keyup', 'keypress'].forEach((ev) => root.addEventListener(ev, (e) => {      // jangan bocor ke shortcut halaman
    if (e.target.matches && e.target.matches('[data-set],[data-rset]')) e.stopPropagation();
  }));
  window.addEventListener('message', (e) => {
    // tombol "Ganti kuesioner" di FASIH Sheet -> muat ulang halaman pemuat di iframe
    if (customFrame && e.source === customFrame.contentWindow && e.data && e.data.__fasihBatch === 'custom-reload') return loadCustom(true);
    if (e.source !== window || !e.data) return;
    if (e.data.__fasihBatch === 'toggle') toggle();                 // klik ikon extension
    if (e.data.__fasihBatch === 'load-error') lastLoadError = e.data.error;
  });
  window.addEventListener('beforeunload', (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } });
  setTimeout(() => resumeApprovalQueue(), 900);

  window.OTOMASI_DC_BATCH = Object.freeze({ register, get current() { return mod; }, version: '1.2.0' });

  /* ---------------- muat ulang script terakhir ---------------- */
  buildUI();
  setView('auto');                                      // langsung ke antrean OTOMASI-DC
  const saved = LS.get(K.code, null);
  if (saved && saved.code) {
    runCode(saved.code, saved.name).catch((e) => {
      msg(`Script tersimpan (${saved.name}) gagal dimuat: ${errText(e)} — import ulang.`, 'err');
      console.error('[OTOMASI_DC_BATCH]', e);
    });
  }
})();
