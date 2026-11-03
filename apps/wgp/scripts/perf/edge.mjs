/**
 * A stand-in for Vercel's edge in front of `next start`, for load measurements: it forwards
 * every request uncompressed and answers with Brotli (quality 4, about what production
 * sends) for the types Vercel compresses, glTF binaries included, so local byte counts match
 * production's instead of `next start`'s gzip (which leaves .glb files raw).
 *
 *   node apps/wgp/scripts/perf/edge.mjs --port 3690 --to 3691
 */
import { createServer, request } from "node:http";
import { constants, createBrotliCompress } from "node:zlib";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1];
};
const port = Number(opt("port", "3690"));
const to = Number(opt("to", "3691"));
const COMPRESSIBLE = /^(text\/|application\/(javascript|x-javascript|json|xml|wasm|manifest\+json)|image\/svg\+xml|image\/x-icon|model\/gltf)/;

createServer((req, res) => {
  const wantsBr = /\bbr\b/.test(String(req.headers["accept-encoding"] ?? ""));
  const headers = { ...req.headers, "accept-encoding": "identity", host: `localhost:${to}` };
  const up = request({ host: "127.0.0.1", port: to, method: req.method, path: req.url, headers }, (r) => {
    const type = String(r.headers["content-type"] ?? "");
    const h = { ...r.headers };
    if (wantsBr && COMPRESSIBLE.test(type) && !h["content-encoding"] && r.statusCode !== 304 && r.statusCode !== 204) {
      delete h["content-length"];
      h["content-encoding"] = "br";
      h.vary = h.vary ? `${h.vary}, Accept-Encoding` : "Accept-Encoding";
      res.writeHead(r.statusCode, h);
      r.pipe(createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })).pipe(res);
    } else {
      res.writeHead(r.statusCode, h);
      r.pipe(res);
    }
  });
  up.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(up);
}).listen(port, () => console.log(`edge on ${port} → ${to}`));
