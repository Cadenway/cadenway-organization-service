import { zodDto } from '@cadenway/nest-common';
import { z } from 'zod';

/** The membership route declares no query parameters. */
export class GetSearchMembershipQuery extends zodDto(z.strictObject({})) {}
