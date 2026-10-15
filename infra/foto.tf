# La pipeline delle foto:
#   Mac (npm run carica) ──JPG──► S3 ──notifica──► SQS ──► Lambda analizza-foto ──► Bedrock + RDS
# Se l'analisi fallisce, SQS riprova; dopo 3 tentativi il messaggio va nella dead letter queue.

resource "aws_s3_bucket" "foto" {
  bucket = "${var.progetto}-foto-${data.aws_caller_identity.io.account_id}"
}

resource "aws_s3_bucket_public_access_block" "foto" {
  bucket                  = aws_s3_bucket.foto.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- Coda ---

resource "aws_sqs_queue" "analisi_dlq" {
  name                      = "${var.progetto}-analisi-dlq"
  message_retention_seconds = 14 * 24 * 3600 # 14 giorni per guardare con calma le foto che non passano
}

resource "aws_sqs_queue" "analisi" {
  name = "${var.progetto}-analisi"
  # AWS consiglia almeno 6 volte il timeout della Lambda: un messaggio in lavorazione non deve ricomparire.
  visibility_timeout_seconds = 6 * aws_lambda_function.analizza_foto.timeout
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.analisi_dlq.arn
    maxReceiveCount     = 3
  })
}

data "aws_iam_policy_document" "coda_da_s3" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.analisi.arn]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.foto.arn] # solo il nostro bucket può scrivere nella coda
    }
  }
}

resource "aws_sqs_queue_policy" "analisi" {
  queue_url = aws_sqs_queue.analisi.id
  policy    = data.aws_iam_policy_document.coda_da_s3.json
}

resource "aws_s3_bucket_notification" "foto_nuove" {
  bucket = aws_s3_bucket.foto.id
  queue {
    queue_arn     = aws_sqs_queue.analisi.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "data/foto/"
    filter_suffix = ".jpg"
  }
  depends_on = [aws_sqs_queue_policy.analisi]
}

# --- Lambda di analisi ---

resource "aws_iam_role" "analizza_foto" {
  name               = "${var.progetto}-analizza-foto"
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
}

resource "aws_iam_role_policy" "analizza_foto" {
  role   = aws_iam_role.analizza_foto.id
  policy = data.aws_iam_policy_document.comune.json
}

# Log su CloudWatch e lettura dalla coda: le policy gestite da AWS per questi due casi.
resource "aws_iam_role_policy_attachment" "analizza_foto_sqs" {
  role       = aws_iam_role.analizza_foto.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole"
}

resource "aws_cloudwatch_log_group" "analizza_foto" {
  name              = "/aws/lambda/${var.progetto}-analizza-foto"
  retention_in_days = 14 # i log costano: due settimane bastano per capire un errore
}

resource "aws_lambda_function" "analizza_foto" {
  function_name    = "${var.progetto}-analizza-foto"
  role             = aws_iam_role.analizza_foto.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"] # Graviton: ~20% meno caro a parità di tempo
  handler          = "index.handler"
  s3_bucket        = aws_s3_object.lambda["analizza-foto"].bucket
  s3_key           = aws_s3_object.lambda["analizza-foto"].key
  source_code_hash = data.archive_file.lambda["analizza-foto"].output_base64sha256
  memory_size      = 1024
  timeout          = 180 # visione + gabbia + embedding
  environment { variables = local.env_comune }
  depends_on = [aws_cloudwatch_log_group.analizza_foto]
}

resource "aws_lambda_event_source_mapping" "analisi" {
  event_source_arn        = aws_sqs_queue.analisi.arn
  function_name           = aws_lambda_function.analizza_foto.arn
  batch_size              = 1                           # una foto per invocazione: un errore riguarda solo lei
  function_response_types = ["ReportBatchItemFailures"] # vedi batchItemFailures in src/aws/analizza-foto.ts
  # Al massimo 2 foto in parallelo (il minimo che AWS permette): il controllo della gabbia ogni 20 minuti
  # conta sull'ordine degli scatti, e così si limita anche la spesa se arrivano molte foto insieme.
  scaling_config { maximum_concurrency = 2 }
}
