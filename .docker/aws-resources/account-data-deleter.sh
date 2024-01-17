
#!/bin/bash
set -x

SQS=(
pocket-account-data-delete-queue
)

for sqs_queue in "${SQS[@]}"; do
  awslocal sqs create-queue --queue-name "${sqs_queue}"
done

set +x
