type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
};

type PaginateOptions = {
  page?: number;
  size?: number;
  sort?: string;
  order?: string;
};

type Projection = string | Record<string, number | boolean>;

type PaginateModel<T> = import('mongoose').Model<T> & {
  paginate(
    filter?: Record<string, unknown>,
    options?: PaginateOptions,
    projection?: Projection,
  ): Promise<PaginatedResponse<T>>;
};

type BaseDocument<T> = T & {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
};
