import { SQSRecord } from 'aws-lambda';
import { sendForgotPasswordEmail } from '../braze';
import {
  sqsLambdaEventBridgeEvent,
  PocketEventType,
} from '@pocket-tools/event-bridge';

/**
 * Given an account delete event, make a request to send the account deletion
 * email.
 * @param record SQSRecord containing forwarded event from eventbridge
 * @throws Error if response is not ok
 */
export async function forgotPasswordHandler(record: SQSRecord) {
  const event = sqsLambdaEventBridgeEvent(record);
  if (event?.['detail-type'] === PocketEventType.FORGOT_PASSWORD) {
    return await sendForgotPasswordEmail({
      resetPasswordToken: event.detail.passwordResetInfo.resetPasswordToken,
      resetTimeStamp: event.detail.passwordResetInfo.timestamp,
      encodedId: event.detail.user.encodedId,
      resetPasswordUsername:
        event.detail.passwordResetInfo.resetPasswordUsername,
    });
  }
  return;
}
