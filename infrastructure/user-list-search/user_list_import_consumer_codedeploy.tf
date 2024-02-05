resource "aws_codedeploy_app" "lambda_user_list_import" {
  compute_platform = "Lambda"
  name             = "${local.prefix}-UserListImport"
}

resource "aws_codedeploy_deployment_group" "lambda_user_list_import" {
  app_name               = aws_codedeploy_app.lambda_user_list_import.name
  deployment_config_name = "CodeDeployDefault.LambdaAllAtOnce"
  deployment_group_name  = "${local.prefix}-UserListImport"
  service_role_arn       = aws_iam_role.lambda_codedeploy_role.arn

  deployment_style {
    deployment_type   = "BLUE_GREEN"
    deployment_option = "WITH_TRAFFIC_CONTROL"
  }

  auto_rollback_configuration {
    enabled = true
    events = [
      "DEPLOYMENT_FAILURE"
    ]
  }
}

resource "aws_codestarnotifications_notification_rule" "lambda_user_list_import_notifications" {
  detail_type = "BASIC"
  event_type_ids = [
    "codedeploy-application-deployment-failed",
  ]

  name     = aws_codedeploy_app.lambda_user_list_import.name
  resource = "arn:aws:codedeploy:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:application:${aws_codedeploy_app.lambda_user_list_import.name}"

  target {
    address = data.aws_sns_topic.backend-deploy-topic.arn
  }
}
