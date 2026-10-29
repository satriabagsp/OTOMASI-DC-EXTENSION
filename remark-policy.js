/* Aturan remark per usaha: #0 satu kali dan tidak bercampur remark lain. */
(function (root) {
  const zero = (value) => /^#(?:DC_)?0+$/i.test(String(value ?? '').trim());
  const text = (value) => String(value ?? '').trim();

  function normalize(row, remarks) {
    const result = { ...row };
    const filled = remarks.filter((r) => text(result[r.key]));
    const nonzero = filled.filter((r) => !zero(result[r.key]));
    if (nonzero.length) {
      for (const r of filled) if (zero(result[r.key])) result[r.key] = '';
    } else if (filled.length) {
      for (const r of filled.slice(1)) result[r.key] = '';
    } else if (!remarks.some((r) => text(result[r.dataKey])) && remarks.length) {
      // Usaha tanpa perubahan membutuhkan satu tanda #0.
      result[remarks[0].key] = '#0';
    }
    return result;
  }

  function validate(row, remarks) {
    const errors = {};
    const filled = remarks.filter((r) => text(row[r.key]));
    const zeroes = filled.filter((r) => zero(row[r.key]));
    const others = filled.filter((r) => !zero(row[r.key]));
    if (zeroes.length && others.length) errors[zeroes[0].key] = '#0 tidak boleh bercampur dengan remark lain';
    if (zeroes.length > 1 && !others.length) errors[zeroes[1].key] = 'cukup satu remark #0 per usaha';
    for (const r of remarks) {
      if (text(row[r.dataKey]) && (!text(row[r.key]) || zero(row[r.key]))) {
        errors[r.key] = 'nilai yang diubah harus memiliki remark perubahan';
      }
    }
    if (!filled.length) errors[remarks[0]?.key || 'remark'] = 'usaha membutuhkan remark';
    return errors;
  }

  function conflict(notes, suffix, requested) {
    if (!suffix || !Array.isArray(notes)) throw new Error('Remark FASIH tidak dapat diperiksa secara aman.');
    const existing = [];
    const ownSuffix = '#' + String(suffix);
    for (const note of notes) {
      if (!note || typeof note.dataKey !== 'string' || !note.dataKey.endsWith(ownSuffix)) continue;
      if (!Array.isArray(note.comments)) throw new Error('Struktur remark FASIH tidak dikenali.');
      for (const item of note.comments) {
        const value = text(item && item.comment);
        if (value) existing.push(value);
      }
    }
    const incoming = requested.map((r) => text(r.text)).filter(Boolean);
    const all = [...existing, ...incoming];
    if (all.some(zero) && all.some((v) => !zero(v))) {
      return 'Remark #0 dan remark lain akan bercampur pada usaha ini; periksa catatan FASIH dahulu.';
    }
    return '';
  }

  const api = { zero, normalize, validate, conflict };
  root.OTOMASI_DC_REMARK_POLICY = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
