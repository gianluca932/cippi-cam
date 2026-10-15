# Quello che le due Lambda hanno in comune: variabili d'ambiente e permessi.
# Il codice arriva da infra/build/, prodotto da `npm run build:lambda` (esbuild) prima di plan/apply.

locals {
  # Le stesse variabili del .env locale: il codice non sa dove gira (vedi src/modelli/llm.ts e src/db/connessione.ts).
  # AWS_REGION non si imposta: la mette Lambda.
  env_comune = {
    LLM_PROVIDER      = "bedrock"
    VISION_MODEL      = var.modello_visione
    AGENT_MODEL       = var.modello_agente
    EMBED_MODEL       = var.modello_embedding
    EMBED_DIMENSIONI  = tostring(var.dimensioni_embedding)
    DB_PROVIDER       = "rds"
    DB_HOST           = aws_db_instance.diario.address
    DB_PORT           = tostring(aws_db_instance.diario.port)
    DB_NAME           = aws_db_instance.diario.db_name
    DB_USER           = local.db_utente
    FOTO_BUCKET       = aws_s3_bucket.foto.bucket
    IMPRONTE_IMMAGINI = "no" # CLIP resta sul Mac: vedi salvaImpronta in src/foto/importazione.ts
    NODE_OPTIONS      = "--enable-source-maps"
  }
}

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Minimo privilegio: ogni permesso dice su QUALE risorsa.
data "aws_iam_policy_document" "comune" {
  statement {
    sid     = "LoginDatabase"
    actions = ["rds-db:connect"]
    # Solo l'utente "diario" di questa istanza: il token IAM non apre il master.
    resources = ["arn:aws:rds-db:${var.regione}:${data.aws_caller_identity.io.account_id}:dbuser:${aws_db_instance.diario.resource_id}/${local.db_utente}"]
  }
  statement {
    sid     = "Bedrock"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    # I profili "eu." smistano la richiesta tra più regioni europee: serve il permesso sul profilo
    # e sui modelli in ognuna di quelle regioni (da qui il "*" sulla regione dei foundation-model).
    resources = [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:${var.regione}:${data.aws_caller_identity.io.account_id}:inference-profile/*",
    ]
  }
  statement {
    sid       = "LeggiFoto"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.foto.arn}/data/foto/*"]
  }
}

data "archive_file" "lambda" {
  for_each    = toset(["api", "analizza-foto"])
  type        = "zip"
  source_dir  = "${path.module}/build/${each.key}"
  output_path = "${path.module}/build/${each.key}.zip"
}

# Gli zip passano da S3: con l'upload diretto il provider manda lo zip in base64 dentro la richiesta
# CreateFunction e fallisce ("bufio.Scanner: token too long"). Da S3 la richiesta porta solo bucket e chiave.
resource "aws_s3_bucket" "codice" {
  bucket        = "${var.progetto}-codice-${data.aws_caller_identity.io.account_id}"
  force_destroy = true # contiene solo build rigenerabili
}

resource "aws_s3_bucket_public_access_block" "codice" {
  bucket                  = aws_s3_bucket.codice.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_object" "lambda" {
  for_each    = data.archive_file.lambda
  bucket      = aws_s3_bucket.codice.id
  key         = "${each.key}.zip"
  source      = each.value.output_path
  source_hash = each.value.output_md5 # ricarica lo zip quando cambia il build
}
