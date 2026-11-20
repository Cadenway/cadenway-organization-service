import {
  DeleteOrganizationLogoInternalHeader,
  ReserveOrganizationLogoUploadInternalBody,
  ReserveOrganizationLogoUploadInternalHeader,
} from '@cadenway/contracts/validators/internal/organization-service';
import { ProblemException, ZodValidationPipe } from '@cadenway/nest-common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Applies the contract schema while preserving its explicit media refusal statuses. */
export class LogoDeclarationPipe implements PipeTransform {
  // #region Properties
  /** Produces the standard validation problem for structural errors. */
  private readonly validation = new ZodValidationPipe(ReserveOrganizationLogoUploadInternalBody);
  // #endregion

  // #region Methods
  /** Validates the declaration and maps supported semantic refusals to 422. */
  public transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const result = ReserveOrganizationLogoUploadInternalBody.safeParse(value);
    if (result.success) return result.data;
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) => key === 'contentType' || key === 'sizeBytes') &&
      'contentType' in value &&
      'sizeBytes' in value &&
      typeof value.contentType === 'string' &&
      typeof value.sizeBytes === 'number' &&
      Number.isInteger(value.sizeBytes) &&
      value.sizeBytes > 0
    ) {
      if (value.contentType !== 'image/png' && value.contentType !== 'image/svg+xml') {
        throw new ProblemException({ status: 422, code: 'media.unsupported-type' });
      }
      if (value.sizeBytes > 5_242_880) {
        throw new ProblemException({ status: 422, code: 'media.file-too-large' });
      }
    }
    return this.validation.transform(value, metadata);
  }
  // #endregion
}

/** Validates the optional request key exactly as declared by the published contract. */
export function logoRequestKey(value: string | undefined): string | undefined {
  return validateHeaders(ReserveOrganizationLogoUploadInternalHeader, {
    'Idempotency-Key': value,
  })['Idempotency-Key'];
}

/** Parses the single strong ETag accepted for logo changes. */
export function logoExpectedVersion(value: string | undefined): number | undefined {
  const header = validateHeaders(DeleteOrganizationLogoInternalHeader, { 'If-Match': value })[
    'If-Match'
  ];
  return header === undefined ? undefined : Number(header.slice(1, -1));
}

/** Keeps header validation problems in the standard contract location. */
function validateHeaders<TResult>(schema: z.ZodType<TResult>, value: unknown): TResult {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ProblemException({
    status: 400,
    code: 'request.invalid',
    details: {
      issues: result.error.issues.map((issue) => ({
        in: 'header',
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    },
  });
}
