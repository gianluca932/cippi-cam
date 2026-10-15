# Il frontend (web/dist) su S3, servito da CloudFront. Stesso dominio per le pagine e per /api:
#   /*      → bucket S3 (privato: lo legge solo CloudFront, tramite Origin Access Control)
#   /api/*  → Function URL della Lambda api, senza cache
# I file si caricano dopo l'apply con `npm run deploy:web` (build + aws s3 sync + invalidazione).

resource "aws_s3_bucket" "web" {
  bucket = "${var.progetto}-web-${data.aws_caller_identity.io.account_id}"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.progetto}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# React Router gestisce le pagine nel browser: /archivio/2026-10-14 non è un file su S3.
# Ogni percorso senza estensione diventa /index.html. Non si usano le "custom error responses"
# di CloudFront perché valgono per tutta la distribuzione e trasformerebbero anche i 404 dell'API in pagine HTML.
#
# La stessa funzione chiede la password per tutto il sito. Se fosse protetta solo l'API, il browser non mostrerebbe
# il riquadro di login (non lo fa per le fetch) e la pagina vedrebbe l'API "offline". Così il login arriva
# all'apertura e il browser rimanda da solo le credenziali alle chiamate /api dello stesso sito.
# L'API resta protetta anche per conto suo (Basic Auth in app.ts), per chi chiama direttamente la Function URL.
# La password finisce nel codice della funzione: la vede solo chi ha accesso all'account AWS.
resource "aws_cloudfront_function" "spa" {
  name    = "${var.progetto}-spa"
  runtime = "cloudfront-js-2.0"
  code    = <<-JS
    function handler(event) {
      var req = event.request;
      var auth = req.headers.authorization;
      if (!auth || auth.value !== "Basic ${base64encode("cippi:${random_password.api.result}")}") {
        return {
          statusCode: 401,
          statusDescription: "Unauthorized",
          headers: { "www-authenticate": { value: 'Basic realm="Cippi Cam"' } },
        };
      }
      if (!req.uri.includes(".")) req.uri = "/index.html";
      return req;
    }
  JS
}

data "aws_cloudfront_cache_policy" "ottimizzata" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disattivata" {
  name = "Managed-CachingDisabled"
}

# Inoltra all'API tutti gli header (compreso Authorization della Basic Auth) tranne Host,
# che deve essere quello della Function URL.
data "aws_cloudfront_origin_request_policy" "tutto_tranne_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

locals {
  dominio_api = trimsuffix(trimprefix(aws_lambda_function_url.api.function_url, "https://"), "/")
}

resource "aws_cloudfront_distribution" "sito" {
  enabled             = true
  comment             = "Cippi Cam"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # solo Europa e Nord America: costa meno e ci basta

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = "api"
    domain_name = local.dominio_api
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60 # il primo byte può tardare: avvio a freddo della Lambda + primo giro dell'agente
    }
  }

  default_cache_behavior {
    target_origin_id       = "web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.ottimizzata.id
    compress               = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disattivata.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.tutto_tranne_host.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true # dominio *.cloudfront.net; un dominio tuo si aggiunge dopo (ACM in us-east-1)
  }
}

# Il bucket si legge solo attraverso QUESTA distribuzione.
data "aws_iam_policy_document" "web_da_cloudfront" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.sito.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_da_cloudfront.json
}
