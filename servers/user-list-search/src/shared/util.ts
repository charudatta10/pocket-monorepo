import { captureException } from '../sentry';
import striptags from 'striptags';

export const normalizeFullText = (
  html: string | undefined | null,
): string | null => {
  if (!html) {
    return null;
  }

  const norm = striptags(html);
  return norm.trim().replace(/\s{3,}/, ' ');
};

/**
 * Normalize all dates to Date a the source.
 *
 * @param date
 */
export const normalizeDate = (date: Date): string | null => {
  if (!date) {
    return null;
  }

  // we are receiving a non-null Date object but it's still throwing an error, so we need to figure out what is wrong with this date
  try {
    return date.toISOString();
  } catch (err) {
    captureException('normalizeDate failed', {
      data: { date },
    });
    return null;
  }
};

/**
 * Capture process related exception
 * @param exception
 * @param message
 */
export const captureProcessException = (
  exception: any,
  message?: string,
): void => {
  exception = JSON.stringify(exception);

  if (message) {
    console.error(message, exception);
  } else {
    console.error(exception);
  }

  captureException(exception);
};

/**
 * Convert mysql timestamp to a date object
 * @param timestamp
 */
export const mysqlTimeStampToDate = (timestamp: string): Date | null => {
  timestamp = timestamp ?? '';

  if (!timestamp.trim()) {
    return null;
  }

  if (/^0000-00-00/.test(timestamp)) {
    return null;
  }

  return new Date(timestamp);
};

export const normalizeUrl = (url: string): string => {
  return url.replace(/\?.*$/, '');
};
