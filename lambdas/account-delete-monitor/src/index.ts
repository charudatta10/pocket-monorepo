import { config } from './config.ts';
import * as Sentry from '@sentry/aws-serverless';
Sentry.init({
  dsn: config.sentry.dsn,
  release: config.sentry.release,
  environment: config.app.environment,
  serverName: config.app.name,
});

import type {
  SQSEvent,
  SQSBatchResponse,
  SQSBatchItemFailure,
} from 'aws-lambda';
import { handlers } from './handlers/index.ts';
import { serverLogger } from '@pocket-tools/ts-logger';

/**
 * The main handler function which will be wrapped by Sentry prior to export.
 * Processes messages originating from event bridge. The detail-type field in
 * the message is used to determine which handler should be used for processing.
 * @param event
 * @returns
 */
export async function processor(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchFailures: SQSBatchItemFailure[] = [];
  serverLogger.info({
    message: 'Received event records.',
    records: { record: JSON.stringify(event.Records) },
  });
  for await (const record of event.Records) {
    try {
      const message = JSON.parse(JSON.parse(record.body).Message);
      serverLogger.info({
        message: 'Received record.',
        record: { record: JSON.stringify(message) },
      });
      if (handlers[message['detail-type']] == null) {
        serverLogger.error({
          message: 'Missing handler.',
          record: {
            'detail-type': message['detail-type'],
            record: JSON.stringify(message),
          },
        });
        continue;
      }
      await handlers[message['detail-type']](record);
    } catch (error) {
      serverLogger.error({
        message: 'Errored record.',
        error,
        record: {
          error,
          record: JSON.stringify(record),
        },
      });
      Sentry.captureException(error);
      batchFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: batchFailures };
}

export const handler = Sentry.wrapHandler(processor);
