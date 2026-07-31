// Proxy unduhan: GET /api/file?u=<media_url>&name=<filename>
// Menstream file dari CDN TikTok/IG dengan header attachment,
// supaya klik tombol = langsung tersimpan (bukan terbuka di tab).
import { Readable } from "node:stream";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export default async function handler(req, res) {
  try {
    const u = req.query.u;
    const name = (req.query.name || "download").replace(/[^\w\d._-]+/g, "_");
    if (!u || !/^https?:\/\//i.test(u))
      return res.status(400).send("URL media tidak valid.");

    const upstream = await fetch(u, {
      headers: { "User-Agent": UA, Referer: "https://www.tiktok.com/" },
    });
    if (!upstream.ok || !upstream.body)
      return res.status(502).send("Gagal mengambil file dari sumber.");

    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/octet-stream"
    );
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "no-store");

    // Stream tanpa buffer penuh (menghindari batas ukuran response).
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    res.status(500).send("Error proxy: " + (e.message || e));
  }
}
