import type { FactoryProvider } from '@nestjs/common';

import { SystemClock } from '../../../../../../infrastructure/system-clock.js';
import type { Clock } from '../../../../application/ports/outbound/time/organizations/clock.port.js';
import { CLOCK } from '../../../tokens/organizations/clock.token.js';

/**
 * Constant clockProvider
 *
 * @description
 * Supplies wall-clock time to the operations of the organizations module.
 *
 * @type {FactoryProvider<Clock>}
 */
export const clockProvider: FactoryProvider<Clock> = {
  provide: CLOCK,
  useFactory: (): Clock => new SystemClock(),
};
