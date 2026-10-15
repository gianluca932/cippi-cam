// Pubblica il frontend su AWS: build con VITE_ONLINE=1 (senza pagina Live), copia su S3, svuota la cache di CloudFront.
// Uso: npm run deploy:web   (dopo terraform apply; WEB_BUCKET e CLOUDFRONT_ID nel .env, da `terraform output env_mac`)
import { execFileSync } from "node:child_process";

try {
  process.loadEnvFile(".env");
} catch {
  // nessun .env: le variabili possono arrivare dalla shell
}
const { WEB_BUCKET, CLOUDFRONT_ID } = process.env;
if (!WEB_BUCKET || !CLOUDFRONT_ID) {
  console.error("❌ Servono WEB_BUCKET e CLOUDFRONT_ID nel .env: cd infra && terraform output env_mac");
  process.exit(1);
}
const esegui = (cmd, args, env = {}) => execFileSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });

esegui("npm", ["run", "build", "--prefix", "web"], { VITE_ONLINE: "1" });
// I file di Vite hanno l'hash nel nome: si possono tenere in cache a lungo. index.html no, va sempre ricontrollato.
esegui("aws", ["s3", "sync", "web/dist", `s3://${WEB_BUCKET}`, "--delete", "--exclude", "index.html", "--cache-control", "public,max-age=31536000,immutable"]);
esegui("aws", ["s3", "cp", "web/dist/index.html", `s3://${WEB_BUCKET}/index.html`, "--cache-control", "no-cache"]);
esegui("aws", ["cloudfront", "create-invalidation", "--distribution-id", CLOUDFRONT_ID, "--paths", "/index.html", "--query", "Invalidation.Status", "--output", "text"]);
console.log("✓ Frontend pubblicato");
