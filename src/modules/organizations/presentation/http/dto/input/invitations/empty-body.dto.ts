import { ResendInvitationInternalBody } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';
import { z } from 'zod';

/**
 * Class EmptyBody
 *
 * @description
 * The empty object `{}` the actions on an invitation carry (`EmptyRequest`, with
 * `additionalProperties: false`): a body that is not an object, or that has a member, answers
 * `400 request.invalid`. The generated validator strips unknown members, so the shape is made
 * strict here.
 */
export class EmptyBody extends zodDto(z.strictObject(ResendInvitationInternalBody.shape)) {}
