import { readFile, writeFile } from "node:fs/promises";
const raw = process.argv[2];
if (!raw) {
  console.error(
    "Usage: npm run configure:vercel -- https://your-api.onrender.com",
  );
  process.exit(1);
}
const url = new URL(raw);
if (
  url.protocol !== "https:" ||
  url.pathname !== "/" ||
  url.username ||
  url.password
)
  throw Error("Use an HTTPS origin without path or credentials");
const config = JSON.parse(await readFile("vercel.json", "utf8"));
config.rewrites[0].destination = url.origin + "/api/:path*";
await writeFile("vercel.json", JSON.stringify(config, null, 2) + "\n");
console.log(
  "Vercel API proxy configured. Commit vercel.json before deploying.",
);
