# Downloader IG & TikTok

Web sederhana: tempel link TikTok/Instagram → muncul tombol download.

## Struktur
```
downloader/
├─ index.html        # tampilan (paste link + tombol download)
├─ api/download.js   # resolver: TikTok (tikwm) + Instagram (parse publik)
├─ api/file.js       # proxy paksa-unduh (streaming, attachment)
└─ vercel.json
```

## Cara deploy ke Vercel
1. Buka https://vercel.com → **Add New → Project**.
2. Upload/hubungkan folder ini (drag folder, atau push ke GitHub lalu import).
3. Deploy. Selesai — tidak perlu setting apa pun, tanpa API key.

Atau lewat CLI:
```bash
npm i -g vercel
cd downloader
vercel --prod
```

## Cara pakai
Tempel link → **Proses** → klik tombol **Unduh**.

## Catatan penting
- **TikTok**: video tanpa watermark / HD / musik / foto slideshow. Stabil (via tikwm).
- **Instagram**: hanya **post/reel PUBLIK**. IG sering ganti struktur — kalau suatu
  saat IG gagal, yang perlu diperbarui hanya bagian `resolveInstagram()` di
  `api/download.js` (regex `video_url` / `display_url`).
- Link video kadang punya token yang cepat kedaluwarsa — proses ulang jika gagal.
- Video sangat besar bisa kena batas free-tier Vercel; kalau perlu, upgrade plan
  atau ganti tombol jadi buka-langsung link CDN.
- Pakai hanya untuk konten milik sendiri / berizin. Kepatuhan pada ToS
  TikTok & Instagram dan hak cipta jadi tanggung jawab pengguna.
```
