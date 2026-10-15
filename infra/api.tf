# L'API: la stessa app Hono del server locale (src/server/app.ts) in una Lambda con Function URL.
# RESPONSE_STREAM: la chat in SSE arriva parola per parola anche online.
# Davanti c'è CloudFront (frontend.tf): il browser vede un solo dominio per pagine e /api.

# Online ogni domanda alla chat costa chiamate a Bedrock: tutta l'API è dietro Basic Auth (utente "cippi").
resource "random_password" "api" {
  length  = 24
  special = false # niente caratteri che diano fastidio in un URL o in una shell
}

resource "aws_iam_role" "api" {
  name               = "${var.progetto}-api"
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
}

resource "aws_iam_role_policy" "api" {
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.comune.json
}

resource "aws_iam_role_policy_attachment" "api_log" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.progetto}-api"
  retention_in_days = 14
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.progetto}-api"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  s3_bucket        = aws_s3_object.lambda["api"].bucket
  s3_key           = aws_s3_object.lambda["api"].key
  source_code_hash = data.archive_file.lambda["api"].output_base64sha256
  memory_size      = 1024
  timeout          = 120 # una domanda all'agente può richiedere più giri modello ↔ tool
  environment {
    variables = merge(local.env_comune, { API_PASSWORD = random_password.api.result })
  }
  depends_on = [aws_cloudwatch_log_group.api]
}

# Senza autenticazione IAM: la protezione è la Basic Auth dentro l'app.
# (Con IAM + Origin Access Control, CloudFront richiederebbe al browser l'hash del corpo di ogni POST: la chat non funzionerebbe.)
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"
}

resource "aws_lambda_permission" "api_url" {
  statement_id           = "FunctionUrlPubblica"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}
