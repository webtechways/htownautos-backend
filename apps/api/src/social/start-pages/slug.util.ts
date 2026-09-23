import { BadRequestException } from '@nestjs/common';

/** Lowercase a-z 0-9 and "-", 3..40 (verbatim rule from contract.ts `StartPage.slug`). */
const SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;

/** Paths that already mean something on `app.htownautos.com` (or would be confusing as a public start page). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api',
  'app',
  'admin',
  'auth',
  'dashboard',
  'settings',
  'start',
  'public',
  'login',
  'logout',
  'signup',
  'signin',
  'register',
  'www',
  'static',
  'assets',
  'help',
  'support',
  'about',
  'contact',
  'terms',
  'privacy',
  'pricing',
  'blog',
  'docs',
  'social',
  'social-media',
  'inbox',
  'insights',
  'integrations',
  'portal',
  'new',
  'edit',
  'delete',
  'create',
  'r',
]);

export function isValidSlugFormat(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

/** Throws a 400 with a message the frontend can show verbatim when `slug` fails format or is reserved. Uniqueness (409) is checked separately, against the DB. */
export function validateSlugShape(slug: string): void {
  if (!isValidSlugFormat(slug)) {
    throw new BadRequestException('El slug debe tener entre 3 y 40 caracteres: minúsculas, números y guiones');
  }
  if (isReservedSlug(slug)) {
    throw new BadRequestException(`"${slug}" es una palabra reservada — elige otro slug`);
  }
}

/** `title` → a candidate slug (not guaranteed available or non-reserved — caller still validates/checks). */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length >= 3 ? base : `${base}-page`.slice(0, 40);
}
