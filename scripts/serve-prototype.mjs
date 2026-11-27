// Tiny static server for the single-file prototype.
// The prototype loads its Spine assets from ../assets, so it must be served from the repo root.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT ?? 5180);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".atlas": "text/plain",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  if (path === "" || path.endsWith("/")) path = join(path || "prototype/", "index.html");
  const file = resolve(root, path);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => {
  console.log(`Prototype: http://localhost:${port}/prototype/`);
});
