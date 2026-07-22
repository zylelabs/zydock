import type { Context } from 'hono';
import type { Model } from 'mongoose';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

export const paginationQuery = (c: Context) => {
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const size = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(c.req.query('size')) || DEFAULT_PAGE_SIZE),
  );
  const sort = c.req.query('sort') || 'createdAt';
  const order = c.req.query('order') === 'asc' ? 'asc' : 'desc';

  return { page, size, sort, order };
};

export const paginateStatics = {
  async paginate(
    this: Model<unknown>,
    filter: Record<string, unknown> = {},
    {
      page = 1,
      size = DEFAULT_PAGE_SIZE,
      sort = 'createdAt',
      order = 'desc',
    }: PaginateOptions = {},
    select?: Projection,
  ) {
    const skip = (page - 1) * size;
    const sortOption: Record<string, 1 | -1> = { [sort]: order === 'asc' ? 1 : -1 };

    const query = this.find(filter).sort(sortOption).skip(skip).limit(size);

    if (select) {
      query.select(select);
    }

    const [items, total] = await Promise.all([query, this.countDocuments(filter)]);

    return { items, total, page, size, pages: Math.ceil(total / size) };
  },
};
