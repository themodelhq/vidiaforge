import { describe, expect, test } from 'bun:test';
import { isMissingS3ObjectError } from '../../lib/storage/s3-provider';

describe('isMissingS3ObjectError', () => {
  test('recognizes R2 generic UnknownError when SDK metadata says HTTP 404', () => {
    expect(isMissingS3ObjectError({
      name: 'UnknownError',
      message: 'UnknownError',
      $metadata: { httpStatusCode: 404 },
    })).toBe(true);
  });

  test('recognizes standard S3 missing-key codes', () => {
    expect(isMissingS3ObjectError({ name: 'NoSuchKey', message: 'The specified key does not exist' })).toBe(true);
    expect(isMissingS3ObjectError({ Code: 'NotFound', message: 'Not Found' })).toBe(true);
  });

  test('does not treat storage outages or authorization errors as a missing object', () => {
    expect(isMissingS3ObjectError({
      name: 'UnknownError',
      message: 'Internal Server Error',
      $metadata: { httpStatusCode: 500 },
    })).toBe(false);
    expect(isMissingS3ObjectError({ name: 'AccessDenied', message: 'Access Denied' })).toBe(false);
    expect(isMissingS3ObjectError(new Error('socket hang up'))).toBe(false);
  });

  test('recognizes HTTP 404 status from alternate SDK metadata shapes', () => {
    expect(isMissingS3ObjectError({ name: 'UnknownError', $response: { statusCode: 404 } })).toBe(true);
    expect(isMissingS3ObjectError({ name: 'UnknownError', statusCode: 404 })).toBe(true);
  });
});
