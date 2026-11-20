import type { SearchOrganizationsReader } from '../../../../ports/outbound/persistence/search/search-organizations-reader.port.js';
import type { ListSearchOrganizationsInput } from './list-search-organizations.input.js';
import type { ListSearchOrganizationsOutput } from './list-search-organizations.output.js';

/** Lists organization identifiers for the bounded search rebuild scan. */
export class ListSearchOrganizations {
  // #region Constructor
  /** Binds a snapshot reader. */
  public constructor(private readonly reader: SearchOrganizationsReader) {}
  // #endregion

  // #region Methods
  /** Uses one lookahead ID to determine if the original scan continues. */
  public async execute(
    input: ListSearchOrganizationsInput,
  ): Promise<ListSearchOrganizationsOutput> {
    const { upperId, items } = await this.reader.read(input.position, input.limit + 1);
    const page = items.slice(0, input.limit);
    const afterId = page.at(-1);
    const next =
      items.length > input.limit && upperId !== null && afterId !== undefined
        ? { upperId, afterId }
        : null;
    return { items: page, next };
  }
  // #endregion
}
