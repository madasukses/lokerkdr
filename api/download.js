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

// shortcode IG -> media_id (base64 dengan alfabet IG)
const IG_ALPHA =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function shortcodeToId(sc) {
  let id = 0n;
  for (const ch of sc) {
    const v = IG_ALPHA.indexOf(ch);
    if (v === -1) return null;
    id = id * 64n + BigInt(v);
  }
  return id.toString();
}

// ambil media dari satu "item" respons api/v1
function pushFromItem(item, medias) {
  const addNode = (node) => {
    if (node.video_versions && node.video_versions.length) {
      medias.push({
        label: "Video (MP4)",
        url: node.video_versions[0].url,
        ext: "mp4",
        kind: "video",
      });
    } else if (node.image_versions2?.candidates?.length) {
      medias.push({
        label: "Foto (JPG)",
        url: node.image_versions2.candidates[0].url,
        ext: "jpg",
        kind: "image",
      });
    }
  };
  if (Array.isArray(item.carousel_media) && item.carousel_media.length) {
    item.carousel_media.forEach((n) => addNode(n));
  } else {
    addNode(item);
  }
}

async function resolveInstagram(url) {
  const code = igShortcode(url);
  if (!code)
    return { ok: false, error: "Link Instagram tidak valid (butuh /p/, /reel/, atau /tv/)." };

  const medias = [];
  let thumbnail = "";
  let title = "Konten Instagram";
  let author = "";

  // --- Metode utama: media_id -> endpoint api/v1/media/info (App-ID publik) ---
  // IG memblokir IP datacenter tanpa sesi. Sertakan cookie akun (env var) bila ada.
  const igSession = process.env.IG_SESSIONID || "";
  const igCookie = process.env.IG_COOKIE || (igSession ? `sessionid=${igSession};` : "");
  let loginBlocked = false;

  const mediaId = shortcodeToId(code);
  if (mediaId) {
    const infoUrls = [
      `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
      `https://i.instagram.com/api/v1/media/${mediaId}/info/`,
    ];
    for (const iu of infoUrls) {
      try {
        const headers = {
          "User-Agent": UA,
          "X-IG-App-ID": "936619743392459",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
        };
        if (igCookie) headers.Cookie = igCookie;
        const r = await fetch(iu, { headers });
        const j = await r.json().catch(() => ({}));
        if (j?.message === "login_required" || j?.require_login || r.status === 401 || r.status === 403) {
          loginBlocked = true;
          continue;
        }
        if (!r.ok) continue;
        const item = j?.items?.[0];
        if (!item) continue;
        title = item.caption?.text?.slice(0, 120) || title;
        author = item.user?.username || "";
        thumbnail = item.image_versions2?.candidates?.[0]?.url || thumbnail;
        pushFromItem(item, medias);
        if (medias.length) break;
      } catch {
        /* lanjut ke sumber berikutnya */
      }
    }
  }

  // --- Cadangan: parsing halaman embed (kalau metode utama gagal) ---
  if (!medias.length) {
    const sources = [
      `https://www.instagram.com/reel/${code}/embed/captioned/`,
      `https://www.instagram.com/p/${code}/embed/captioned/`,
    ];
    for (const src of sources) {
      let html = "";
      try {
        html = await fetchText(src);
      } catch {
        continue;
      }
      const uniq = (arr) => [...new Set(arr)].filter((x) => x && x.startsWith("http"));
      const vids = uniq([...html.matchAll(/"video_url":"([^"]+)"/g)].map((m) => unesc(m[1])));
      const imgs = uniq([...html.matchAll(/"display_url":"([^"]+)"/g)].map((m) => unesc(m[1])));
      if (vids.length) {
        vids.forEach((v, i) =>
          medias.push({ label: vids.length > 1 ? `Video ${i + 1}` : "Video (MP4)", url: v, ext: "mp4", kind: "video" })
        );
      } else if (imgs.length) {
        imgs.forEach((im, i) =>
          medias.push({ label: imgs.length > 1 ? `Foto ${i + 1}` : "Foto (JPG)", url: im, ext: "jpg", kind: "image" })
        );
      }
      if (medias.length) {
        thumbnail = thumbnail || imgs[0] || "";
        break;
      }
    }
  }

  if (!medias.length)
    return {
      ok: false,
      error: loginBlocked
        ? "Instagram menolak permintaan dari server (login_required). Setel environment variable IG_SESSIONID di Vercel dengan cookie 'sessionid' akun IG cadangan, lalu redeploy."
        : "Tidak bisa mengambil media. Pastikan post PUBLIK (bukan akun privat/Story). Kalau tetap gagal, IG mungkin memblokir IP server — coba lagi nanti.",
    };

  // beri nomor label kalau carousel (banyak media campur)
  if (medias.length > 1)
    medias.forEach((m, i) => (m.label = `${m.kind === "video" ? "Video" : "Foto"} ${i + 1}`));

  return { ok: true, platform: "instagram", title, author, thumbnail, medias };
}
