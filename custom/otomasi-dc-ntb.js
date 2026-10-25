/* FASIH Batch Extension — Koreksi NTB SE2026 L Blok II
 *
 * Impor file ini lewat: Script-based automation > Import script.
 *
 * Data yang ditempelkan harus berupa TSV dari siapkan_tsv_ntb.py, setelah
 * toggle "Remark" diaktifkan. Sel kosong berarti tidak diubah.
 *
 * Jalankan Dry run terlebih dahulu. LIVE mengubah FASIH.
 */
const NILAI = [
  'gaji',
  'biaya_produksi',
  'biaya_pembelian',
  'operasional',
  'non_operasional',
  'nilai_pendapatan',
  'pendapatan_lain',
];
const PENGELUARAN = ['gaji', 'biaya_produksi', 'biaya_pembelian', 'operasional', 'non_operasional'];
const PENDAPATAN = ['nilai_pendapatan', 'pendapatan_lain'];

function angka(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function rupiah(v) {
  return angka(v).toLocaleString('id-ID');
}
function adaNilai(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

OTOMASI_DC_BATCH.register({
  id: 'koreksi-ntb-se2026-l-blok-ii',
  name: 'Koreksi NTB — SE2026 L Blok II',
  description: 'Mengubah komponen 26a–27b dan menghitung ulang total pengeluaran serta total pendapatan.',

  columns: [
    // Satu assignment dapat memuat beberapa usaha roster. Nama usaha menjadi
    // pembeda baris yang diproses, sehingga assignment_id tidak dibuat unik.
    { key: 'assignment_id', type: 'uuid', required: true, width: 290 },
    { key: 'nama_usaha', title: 'nama_usaha (pembanding)', type: 'text', width: 220 },
    { key: 'gaji', title: 'gaji / 26a (opsional)', type: 'integer' },
    { key: 'biaya_produksi', title: 'biaya_produksi / 26b (opsional)', type: 'integer' },
    { key: 'biaya_pembelian', title: 'biaya_pembelian / 26c (opsional)', type: 'integer' },
    { key: 'operasional', title: 'operasional / 26d (opsional)', type: 'integer' },
    { key: 'non_operasional', title: 'non_operasional / 26e (opsional)', type: 'integer' },
    { key: 'nilai_pendapatan', title: 'nilai_pendapatan / 27a (opsional)', type: 'integer' },
    { key: 'pendapatan_lain', title: 'pendapatan_lain / 27b (opsional)', type: 'integer' },
  ],
  idColumn: 'assignment_id',
  remarks: NILAI.map((dataKey) => ({ dataKey, title: 'remark ' + dataKey })),

  validateRow(row) {
    const error = {};
    for (const key of NILAI) {
      if (!adaNilai(row[key])) continue;
      const value = Number(row[key]);
      if (!Number.isInteger(value) || value < 0) {
        error[key] = 'harus berupa bilangan bulat tidak negatif';
      }
    }
    return Object.keys(error).length ? error : null;
  },

  async process(row, { dryRun, FASIH, remarks = [] }) {
    const assignment = await FASIH.getAssignment(row.assignment_id);
    if (!assignment || !assignment.data) {
      throw new Error('assignment tidak ditemukan atau belum memiliki data');
    }

    const answers = JSON.parse(assignment.data).answers || [];
    const norm = (value) => String(value ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
    const targetName = norm(row.nama_usaha);
    const suffixes = [...new Set(answers
      .filter((answer) => /^(nama_usaha|nama_usaha_edit|nama_komersial)#\d+$/.test(answer.dataKey))
      .filter((answer) => norm(answer.answer) === targetName)
      .map((answer) => answer.dataKey.split('#')[1]))];

    if (!suffixes.length) {
      return { skip: true, code: assignment.code_identity, ket: 'nama usaha tidak ditemukan pada assignment' };
    }
    if (suffixes.length > 1) {
      return { skip: true, code: assignment.code_identity, ket: 'nama usaha cocok pada lebih dari satu baris: #' + suffixes.join(', #') };
    }

    const noUsaha = suffixes[0];
    const tahunItem = answers.find((answer) => answer.dataKey === 'tahun_operasi#' + noUsaha);
    const tahunRaw = String(tahunItem?.answer ?? '').trim();
    if (!/^\d{4}$/.test(tahunRaw)) {
      return {
        skip: true,
        status: 'DILEWATI',
        code: assignment.code_identity,
        ket: '#' + noUsaha + ' tahun operasi kosong atau tidak valid; tidak ada nilai yang diubah',
      };
    }
    const tahunOperasi = Number(tahunRaw);
    if (tahunOperasi >= 2026) {
      return {
        skip: true,
        status: 'DILEWATI',
        code: assignment.code_identity,
        ket: '#' + noUsaha + ' tahun operasi ' + tahunOperasi +
          ' menggunakan isian bulanan; tidak ada nilai yang diubah',
      };
    }

    const cari = (key) => {
      const item = answers.find((answer) => answer.dataKey === key + '#' + noUsaha);
      return item ? angka(item.answer) : 0;
    };
    const perubahan = {};
    for (const key of NILAI) {
      if (!adaNilai(row[key])) continue;
      const baru = Number(row[key]);
      if (cari(key) !== baru) perubahan[key] = baru;
    }
    const remarkKeys = Object.fromEntries(NILAI.map((key) => [key, key + '#' + noUsaha]));

    if (!Object.keys(perubahan).length) {
      // Jangan kirim ulang assignment yang sudah benar-benar selesai. Status
      // "selesai" hanya dipakai bila tujuh nilai dan ketujuh remark dari file
      // sudah ada persis di FASIH; remark sebagian tetap akan dilengkapi.
      let notes = [];
      try { notes = JSON.parse(assignment.comment || '{}').notes || []; } catch {}
      const remarkAda = (rm) => {
        const dataKey = remarkKeys[rm.dataKey];
        return notes.some((note) => note && note.dataKey === dataKey &&
          (note.comments || []).some((comment) => comment && comment.comment === rm.text));
      };
      const semuaRemarkSelesai = remarks.length === NILAI.length && remarks.every(remarkAda);
      if (semuaRemarkSelesai) {
        return {
          skip: true,
          status: 'SELESAI',
          code: assignment.code_identity,
          remarkKeys,
          ket: '#' + noUsaha + ' nilai dan 7 remark sudah ada di FASIH; dilewati',
        };
      }
      if (remarks.length) {
        const kurang = remarks.filter((rm) => !remarkAda(rm)).length;
        return { code: assignment.code_identity, remarkKeys, ket: '#' + noUsaha + ' nilai FASIH sudah sesuai; ' + kurang + ' remark akan diperbarui' };
      }
      return { skip: true, code: assignment.code_identity, ket: '#' + noUsaha + ' nilai FASIH sudah sesuai; remark tidak diaktifkan' };
    }

    const bacaSetelah = (key) => Object.prototype.hasOwnProperty.call(perubahan, key)
      ? perubahan[key] : cari(key);
    const totalPengeluaran = PENGELUARAN.reduce((total, key) => total + bacaSetelah(key), 0);
    const totalPendapatan = PENDAPATAN.reduce((total, key) => total + bacaSetelah(key), 0);
    const result = await FASIH.patch(row.assignment_id, (doc, { set }) => {
      for (const [key, value] of Object.entries(perubahan)) set(key + '#' + noUsaha, value);
      set('total_pengeluaran#' + noUsaha, totalPengeluaran);
      set('total_pendapatan#' + noUsaha, totalPendapatan);
    }, { dryRun, log: false });

    const rincian = Object.entries(perubahan)
      .map(([key, value]) => key + ' ' + rupiah(cari(key)) + ' → ' + rupiah(value));
    return {
      code: result.code,
      remarkKeys,
      ket: [
        '#' + noUsaha,
        ...rincian,
        'total_pengeluaran ' + rupiah(totalPengeluaran),
        'total_pendapatan ' + rupiah(totalPendapatan),
        result.nChanges + ' perubahan',
        dryRun ? 'uji coba' : 'terkirim',
      ].join(' · '),
    };
  },
});



