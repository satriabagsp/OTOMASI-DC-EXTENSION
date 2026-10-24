# Otomasi Perbaikan BPS Jabar

Ekstensi Chromium untuk membantu petugas memproses batch data **siap input**
pada FASIH SE2026 L Blok II. Paket ini ditujukan untuk alur kerja BPS Jawa Barat:
data yang telah dihitung dan divalidasi sebelumnya dimuat dari CSV, diperiksa
terlebih dahulu, dikirim bersama remark, lalu dapat disetujui per assignment.

> Gunakan hanya oleh petugas yang berwenang dan hanya untuk data yang telah
> ditetapkan siap input. Selalu mulai dari batch kecil dan **Dry run**.

## Fitur

- Memuat CSV batch tanpa salin-tempel; formatnya dibuat oleh
  `FASIH_BATCH_NTB/siapkan_tsv_ntb.py`.
- Memproses nilai 26a–27b, menghitung ulang total pengeluaran dan total
  pendapatan, serta menulis tujuh remark `#0`/`#3`.
- **Dry run** untuk membandingkan isi CSV dengan data FASIH sebelum pengiriman.
- Pemeriksaan pekerjaan sebelumnya: jika nilai dan tujuh remark telah sama,
  baris diberi status `SELESAI` dan tidak dikirim ulang.
- Persetujuan batch: tombol **Approve hasil LIVE** membuka assignment satu per
  satu, melakukan approve, dan hanya memberi status `APPROVED` setelah tombol
  **Revoke** terlihat.
- Unduh CSV hasil untuk dokumentasi dan rekonsiliasi lokal.

## Alur operator

1. Buka FASIH dan login dengan akun petugas.
2. Buka ekstensi, klik **Muat CSV batch**, lalu pilih satu file batch (maksimal
   50 usaha).
3. Jalankan **Dry run** dan periksa statusnya.
4. Klik **Jalankan LIVE** hanya untuk data yang sudah benar.
5. Buka salah satu halaman assignment dari periode yang sama, lalu klik
   **Approve hasil LIVE**.
6. Unduh hasil CSV setelah proses selesai.

Baris `SELESAI` masih perlu masuk antrean approve karena nilai dan remark yang
sudah tersimpan tidak otomatis berarti assignment telah disetujui.

## Menyiapkan file batch

Dari folder `D:\SE\OTOMASI-DC\FASIH_BATCH_NTB` jalankan:

```powershell
python siapkan_tsv_ntb.py --semua-folder
```

Keluaran akan dipecah per kabupaten/kota dan per 50 usaha di folder
`DATA_FASIH_BATCH_PER_USAHA/<kode-wilayah>/`.

## Instalasi lokal

1. Buka `chrome://extensions` atau `edge://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked** lalu pilih folder ini.
4. Setelah ada pembaruan file, klik tombol **Reload** pada kartu extension dan
   refresh tab FASIH.

## Batasan

- Extension tidak memperbarui database pusat.
- Status `APPROVED` di extension hanya dipasang setelah antarmuka FASIH
  menampilkan tombol Revoke; bila terjadi error, periksa assignment terkait
  sebelum mengulanginya.
- Jangan menjalankan dua batch yang memuat usaha sama dari browser yang sama.

## Kredit dan lisensi

Paket ini merupakan turunan yang dioptimalkan untuk data siap input BPS Jawa
Barat dari proyek [fasih-batch-extension](https://github.com/nahrx/fasih-batch-extension)
oleh Nahar Ridlo Nasrullah. Struktur awal ekstensi, utilitas FASIH, dan lisensi
MIT dipertahankan sesuai lisensi proyek asal. Perubahan BPS Jabar mencakup
alur CSV siap input, pemetaan roster usaha, remark `#0`/`#3`, pemeriksaan
pekerjaan sebelumnya, persetujuan assignment, dan tampilan operator.

Lihat [LICENSE](LICENSE) untuk teks lisensi MIT lengkap.
