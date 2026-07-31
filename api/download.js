// Vercel Serverless Function  ->  POST /api/download   body: { url: "..." }
// Mengembalikan JSON ternormalisasi berisi daftar media yang bisa diunduh.
//
// Dijalankan di SISI SERVER, jadi bebas dari masalah CORS browser.
// TikTok  -> pakai API gratis tikwm (tanpa API key)
// Instagram -> tarik & parse halaman embed/publik (hanya konten publik)

export default async function handler(req, res) {
  // --- CORS (biar bisa dipanggil dari mana saja / saat dev) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Gunakan metode POST." });

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const url = (body.url || "").trim();
    if (!url) return res.status(400).json({ ok: false, error: "Link kosong." });

    const platform = detectPlatform(url);
    if (platform === "tiktok") return res.json(await resolveTikTok(url));
    if (platform === "instagram") return res.json(await resolveInstagram(url));

    return res.status(400).json({
      ok: false,
      error: "Link tidak dikenali. Tempel link TikTok atau Instagram yang valid.",
    });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: "Gagal memproses link: " + (e.message || e) });
  }
}

/* ---------------- Helpers ---------------- */

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com") || u.includes("vt.tiktok") || u.includes("vm.tiktok"))
    return "tiktok";
  if (u.includes("instagram.com") || u.includes("instagr.am")) return "instagram";
  return "unknown";
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* ---------------- TikTok (tikwm) ---------------- */

async function resolveTikTok(url) {
  const api =
    "https://www.tikwm.com/api/?hd=1&url=" + encodeURIComponent(url);
  const r = await fetch(api, { headers: { "User-Agent": UA } });
  const j = await r.json();

  if (!j || j.code !== 0 || !j.data)
    return { ok: false, error: "Video TikTok tidak ditemukan / bukan publik." };

  const d = j.data;
  const base = "https://www.tikwm.com";
  const abs = (p) => (!p ? "" : p.startsWith("http") ? p : base + p);
  const medias = [];

  // Slideshow foto
  if (Array.isArray(d.images) && d.images.length) {
    d.images.forEach((img, i) =>
      medias.push({
        label: `Foto ${i + 1}`,
        url: abs(img),
        ext: "jpg",
        kind: "image",
      })
    );
  } else {
    if (d.hdplay)
      medias.push({ label: "Video HD (tanpa watermark)", url: abs(d.hdplay), ext: "mp4", kind: "video" });
    if (d.play)
      medias.push({ label: "Video (tanpa watermark)", url: abs(d.play), ext: "mp4", kind: "video" });
    if (d.wmplay)
      medias.push({ label: "Video (dengan watermark)", url: abs(d.wmplay), ext: "mp4", kind: "video" });
  }
  if (d.music || d.music_info?.play)
    medias.push({ label: "Audio / Musik (MP3)", url: abs(d.music || d.music_info.play), ext: "mp3", kind: "audio" });

  return {
    ok: true,
    platform: "tiktok",
    title: d.title || "Video TikTok",
    author: d.author?.nickname || d.author?.unique_id || "",
    thumbnail: abs(d.cover || d.origin_cover),
    medias,
  };
}

/* ---------------- Instagram ---------------- */

function igShortcode(url) {
  const m = url.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

async function fetchText(u) {
  const r = await fetch(u, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
      "X-IG-App-ID": "936619743392459", // app id web IG publik
    },
  });
  return await r.text();
}

function unesc(s) {
  return (s || "")
    .replace(/\\u0026/g, "&")
    .replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
}

async function resolveInstagram(url) {
  const code = igShortcode(url);
  if (!code)
    return { ok: false, error: "Link Instagram tidak valid (butuh /p/, /reel/, atau /tv/)." };

  const medias = [];
  let thumbnail = "";
  let title = "Konten Instagram";

  // Sumber yang dicoba berurutan (halaman embed & halaman post publik)
  const sources = [
    `https://www.instagram.com/reel/${code}/embed/captioned/`,
    `https://www.instagram.com/p/${code}/embed/captioned/`,
    `https://www.instagram.com/p/${code}/`,
  ];

  for (const src of sources) {
    let html = "";
    try {
      html = await fetchText(src);
    } catch {
      continue;
    }

    // Kumpulkan semua video_url & display_url yang muncul di JSON tertanam
    const videos = [...html.matchAll(/"video_url":"([^"]+)"/g)].map((m) => unesc(m[1]));
    const images = [...html.matchAll(/"display_url":"([^"]+)"/g)].map((m) => unesc(m[1]));
    const thumbs = [...html.matchAll(/"display_resources".*?"src":"([^"]+)"/g)].map((m) => unesc(m[1]));

    const uniq = (arr) => [...new Set(arr)].filter((x) => x && x.startsWith("http"));
    const vids = uniq(videos);
    const imgs = uniq(images);

    if (vids.length || imgs.length) {
      vids.forEach((v, i) =>
        medias.push({ label: vids.length > 1 ? `Video ${i + 1}` : "Video (MP4)", url: v, ext: "mp4", kind: "video" })
      );
      // hanya tambahkan gambar kalau tidak ada video (post foto / carousel)
      if (!vids.length) {
        imgs.forEach((im, i) =>
          medias.push({ label: imgs.length > 1 ? `Foto ${i + 1}` : "Foto (JPG)", url: im, ext: "jpg", kind: "image" })
        );
      }
      thumbnail = (thumbs[0] || imgs[0] || "") || thumbnail;
      break;
    }
  }

  if (!medias.length)
    return {
      ok: false,
      error:
        "Tidak bisa mengambil media Instagram. Pastikan akun/post PUBLIK. IG sering mengubah struktur — bagian ini mungkin perlu update.",
    };

  return { ok: true, platform: "instagram", title, author: "", thumbnail, medias };
}
