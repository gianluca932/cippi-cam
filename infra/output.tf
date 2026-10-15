# Quello che serve dopo l'apply: l'indirizzo del sito e le variabili per il .env del Mac
# (npm run carica, npm run db:migra:aws, npm run deploy:web).

output "url" {
  value = "https://${aws_cloudfront_distribution.sito.domain_name}"
}

output "api_password" {
  value     = random_password.api.result
  sensitive = true # si legge con: terraform output -raw api_password
}

output "mcp_url" {
  description = "L'MCP remoto, da aggiungere come connettore personalizzato in claude.ai"
  value       = "https://${aws_cloudfront_distribution.sito.domain_name}/api/mcp/${random_password.mcp.result}"
  sensitive   = true # si legge con: terraform output -raw mcp_url
}

output "env_mac" {
  description = "Da copiare nel .env. Senza DB_PROVIDER: il server locale resta su Docker; per usare RDS dal Mac si aggiunge DB_PROVIDER=rds al comando"
  value       = <<-ENV
    AWS_REGION=${var.regione}
    FOTO_BUCKET=${aws_s3_bucket.foto.bucket}
    DB_HOST=${aws_db_instance.diario.address}
    DB_MASTER_SECRET_ARN=${local.db_master_secret_arn}
    WEB_BUCKET=${aws_s3_bucket.web.bucket}
    CLOUDFRONT_ID=${aws_cloudfront_distribution.sito.id}
  ENV
}

output "dlq" {
  description = "Le foto che non sono passate dopo 3 tentativi"
  value       = aws_sqs_queue.analisi_dlq.url
}
