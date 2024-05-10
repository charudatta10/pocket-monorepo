terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.44.0"
    }
    pagerduty = {
      source  = "pagerduty/pagerduty"
      version = "~> 3.11.0"
    }
  }

  required_version = ">= 1.8.0"
}
