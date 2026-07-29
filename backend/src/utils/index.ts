export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SLUG_SUFFIX_BYTES = 3;
const SLUG_ATTEMPTS = 5;

export const generateUniqueSlug = async (
  name: string,
  fallback: string,
  taken: (slug: string) => Promise<boolean>,
) => {
  const base = slugify(name) || fallback;

  if (!(await taken(base))) {
    return base;
  }

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    const buffer = new Uint8Array(SLUG_SUFFIX_BYTES);

    crypto.getRandomValues(buffer);

    const candidate = `${base}-${Buffer.from(buffer).toString('hex')}`;

    if (!(await taken(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Could not generate a unique slug for "${name}"`);
};
