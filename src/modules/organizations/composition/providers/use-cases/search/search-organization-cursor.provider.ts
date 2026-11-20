import { CONFIG } from '@cadenway/nest-common';
import type { FactoryProvider } from '@nestjs/common';

import type { AppConfig } from '../../../../../../config/app-config.js';
import { SearchOrganizationCursor } from '../../../../presentation/http/mappers/search/search-organization-cursor.mapper.js';

/** Provides the global export's stable cursor signer. */
export const searchOrganizationCursorProvider: FactoryProvider<SearchOrganizationCursor> = {
  provide: SearchOrganizationCursor,
  inject: [CONFIG],
  useFactory: (config: AppConfig): SearchOrganizationCursor =>
    new SearchOrganizationCursor(config.SEARCH_PROJECTION_CURSOR_SECRET),
};
