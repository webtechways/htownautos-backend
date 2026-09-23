import type { SocialTemplateView } from './templates.service';

/**
 * ~12 built-in templates for a used-car dealer in Houston, merged into every
 * GET /social/templates. Ids use the "builtin:<slug>" scheme (contract.ts
 * `SocialTemplate.builtIn`); read-only — templates.service rejects PATCH/DELETE
 * on these ids before touching the DB. Short, with {year} {make} {model}
 * {price} placeholders the composer fills in; Spanish/English mixed the way
 * Houston dealers actually post.
 */
export const BUILT_IN_TEMPLATES: SocialTemplateView[] = [
  {
    id: 'builtin:new-arrival',
    name: 'Nueva llegada',
    content: '🚗 Recién llegado: {year} {make} {model}. ¡Ven a verlo antes que se vaya! 📍 Houston, TX. #NuevaLlegada #HoustonCars',
    category: 'new_arrival',
    builtIn: true,
  },
  {
    id: 'builtin:price-drop',
    name: 'Price Drop',
    content: '🔥 PRICE DROP! {year} {make} {model} now at {price}. Won\'t last long — message us or stop by today.',
    category: 'price_drop',
    builtIn: true,
  },
  {
    id: 'builtin:sold',
    name: 'Vendido',
    content: '✅ VENDIDO: {year} {make} {model}. Gracias por tu confianza. ¿Buscas el tuyo? Tenemos más como este.',
    category: 'sold',
    builtIn: true,
  },
  {
    id: 'builtin:weekend-sale',
    name: 'Weekend Sale',
    content: '🎉 WEEKEND SALE! Precios especiales todo el fin de semana. {year} {make} {model} desde {price}. ¡No te lo pierdas!',
    category: 'weekend_sale',
    builtIn: true,
  },
  {
    id: 'builtin:financing',
    name: 'Financiamiento disponible',
    content: '💳 Financiamiento para todos — buen crédito, mal crédito o sin crédito. Aprobación el mismo día. Pregunta por el {year} {make} {model}.',
    category: 'financing',
    builtIn: true,
  },
  {
    id: 'builtin:trade-in',
    name: 'Trade-In',
    content: '🔄 Trae tu carro y te damos crédito hacia este {year} {make} {model}. Tasación gratis, sin compromiso.',
    category: 'trade_in',
    builtIn: true,
  },
  {
    id: 'builtin:testimonial',
    name: 'Customer testimonial',
    content: '⭐⭐⭐⭐⭐ "Great experience buying my {year} {make} {model} here — thank you!" Real reviews from real customers. Come see why.',
    category: 'testimonial',
    builtIn: true,
  },
  {
    id: 'builtin:auction-find',
    name: 'Auction find',
    content: '🔨 Directo de subasta: {year} {make} {model} a un precio que no vas a encontrar en el lote de al lado. {price}. Inspección disponible.',
    category: 'auction_find',
    builtIn: true,
  },
  {
    id: 'builtin:inspection-tip',
    name: 'Inspection tip',
    content: '🔧 Consejo del taller: antes de comprar cualquier carro usado, pide el reporte de inspección. Nosotros lo hacemos gratis en cada {make} {model} que vendemos.',
    category: 'inspection_tip',
    builtIn: true,
  },
  {
    id: 'builtin:low-mileage',
    name: 'Low mileage',
    content: '📉 Bajo millaje, alto valor: {year} {make} {model}. Cuidado como nuevo. {price}. Se va rápido — llámanos hoy.',
    category: 'low_mileage',
    builtIn: true,
  },
  {
    id: 'builtin:warranty',
    name: 'Warranty included',
    content: '🛡️ Every {year} {make} {model} comes with a warranty you can count on. Buy with confidence — visit us in Houston today.',
    category: 'warranty',
    builtIn: true,
  },
  {
    id: 'builtin:test-drive',
    name: 'Invita a probar',
    content: '🔑 ¿Ya manejaste el {year} {make} {model}? Agenda tu test drive hoy mismo — sin compromiso, sin presión.',
    category: 'test_drive',
    builtIn: true,
  },
];
