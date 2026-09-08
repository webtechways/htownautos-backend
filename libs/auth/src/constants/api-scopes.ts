/**
 * API Key scope registry.
 *
 * Scopes follow the shape `<resource>:<action>` where action is `read` or `write`.
 * `write` implies `read` (enforced in the ApiKeyGuard check).
 */

export const API_SCOPE_ACTIONS = ['read', 'write'] as const;
export type ApiScopeAction = (typeof API_SCOPE_ACTIONS)[number];

export interface ApiScopeResource {
  slug: string;
  label: string;
  description: string;
}

export const API_SCOPE_RESOURCES: ApiScopeResource[] = [
  // — Parts & inventory —
  { slug: 'orders', label: 'Part Orders', description: 'Customer orders for parts (list, read, create, charge, ship)' },
  { slug: 'parts', label: 'Parts', description: 'Parts catalog and inventory' },
  { slug: 'parts-pricing', label: 'Parts Pricing', description: 'Parts pricing rules and lookups' },
  { slug: 'vehicles', label: 'Vehicles', description: 'Vehicle inventory' },
  { slug: 'inventory-assets', label: 'Inventory Assets', description: 'Media and assets attached to inventory' },

  // — Sales —
  { slug: 'deals', label: 'Deals', description: 'Sales deals' },
  { slug: 'leads', label: 'Leads', description: 'Sales leads and lead sources' },
  { slug: 'buyers', label: 'Buyers / Customers', description: 'Customer records' },
  { slug: 'buyer-preferences', label: 'Buyer Preferences', description: 'Buyer vehicle preferences and saved criteria' },
  { slug: 'extra-expense', label: 'Extra Expenses', description: 'Extra expenses attached to deals/vehicles' },
  { slug: 'title', label: 'Titles', description: 'Vehicle title records and status' },

  // — Auctions (Copart) —
  { slug: 'auction-listings', label: 'Auction Listings', description: 'Copart auction inventory, search and facets (read-only)' },
  { slug: 'auction-bids', label: 'Auction Bids', description: 'Buyer auction bids and max-bid orders' },
  { slug: 'listing-groups', label: 'Listing Groups', description: 'Curated groups of auction listings' },
  { slug: 'listing-reviews', label: 'Listing Reviews', description: 'Reviews and analyses on auction listings' },
  { slug: 'vehicle-inspections', label: 'Vehicle Inspections', description: 'Inspection requests, checklists and results' },
  { slug: 'inspection-share-links', label: 'Inspection Share Links', description: 'Public share links for inspections' },
  { slug: 'favorites', label: 'Favorites', description: 'Favorited listings and entities' },
  { slug: 'auction-ingest', label: 'Live Auction Ingest', description: 'Forward live bid/sale frames and claim auctions (scraper VMs)' },

  // — Communications —
  { slug: 'tasks', label: 'Tasks', description: 'Tasks / to-dos' },
  { slug: 'notes', label: 'Notes', description: 'Free-form notes on entities' },
  { slug: 'phone-calls', label: 'Phone Calls', description: 'Call history and dispositions' },
  { slug: 'sms', label: 'SMS', description: 'SMS messages' },
  { slug: 'email-messages', label: 'Email Messages', description: 'Email thread history' },
  { slug: 'social-accounts', label: 'Social Accounts', description: 'Connected social media accounts' },

  // — Shipping —
  { slug: 'shippo', label: 'Shipping (Shippo)', description: 'Addresses, rates, labels, tracking, pickups' },
  { slug: 'parcel-templates', label: 'Parcel Templates', description: 'Packaging templates' },

  // — Administration & reference —
  { slug: 'users', label: 'Users / Staff', description: 'Internal staff users and tenant membership' },
  { slug: 'roles', label: 'Roles & Permissions', description: 'RBAC roles and permissions (read-only recommended)' },
  { slug: 'tenant', label: 'Tenant / Business', description: 'Tenant configuration (read-only recommended)' },
  { slug: 'nomenclators', label: 'Reference Data', description: 'Enums, makes/models, lookups (read-only)' },
  { slug: 'marketcheck', label: 'Market Data', description: 'MarketCheck vehicle market pricing (read-only)' },
  { slug: 'audit-log', label: 'Audit Logs', description: 'Activity and audit history (read-only)' },
];

/** Flat list of every valid scope string. */
export const ALL_API_SCOPES: string[] = API_SCOPE_RESOURCES.flatMap((r) =>
  API_SCOPE_ACTIONS.map((a) => `${r.slug}:${a}`),
);

/**
 * Returns true if the key's granted scopes satisfy `required`.
 * Rule: `<resource>:write` implies `<resource>:read`.
 */
export function hasScope(granted: string[], required: string): boolean {
  if (granted.includes(required)) return true;
  const [resource, action] = required.split(':');
  if (action === 'read' && granted.includes(`${resource}:write`)) return true;
  return false;
}

export function validateScopes(scopes: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const s of scopes) {
    if (ALL_API_SCOPES.includes(s)) valid.push(s);
    else invalid.push(s);
  }
  return { valid, invalid };
}
