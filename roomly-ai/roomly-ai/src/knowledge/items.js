// Furniture and decor items Roomly can recommend.
// weight: share of the budget relative to other chosen items.
// minEGP: below this price a "result" is almost certainly an accessory, cover or wrong product.
// big: large pieces that are sent to the image model as reference photos first.
const ITEMS = {
  sofa:          { en: 'Sofa',            ar: 'كنبة',             search: 'sofa',                weight: 30, minEGP: 3000, big: true,  rooms: ['living_room'] },
  armchair:      { en: 'Armchair',        ar: 'فوتيه',            search: 'armchair',            weight: 12, minEGP: 1500, big: true,  rooms: ['living_room', 'bedroom'] },
  coffee_table:  { en: 'Coffee table',    ar: 'ترابيزة وسط',      search: 'coffee table',        weight: 8,  minEGP: 700,  big: true,  rooms: ['living_room'] },
  side_table:    { en: 'Side table',      ar: 'ترابيزة جانبية',   search: 'side table',          weight: 4,  minEGP: 400,  big: false, rooms: ['living_room', 'bedroom'] },
  tv_unit:       { en: 'TV unit',         ar: 'مكتبة تلفزيون',    search: 'tv unit',             weight: 12, minEGP: 1500, big: true,  rooms: ['living_room'] },
  bookshelf:     { en: 'Bookshelf',       ar: 'مكتبة كتب',        search: 'bookshelf',           weight: 8,  minEGP: 1000, big: true,  rooms: ['living_room', 'home_office', 'kids_room'] },
  rug:           { en: 'Rug',             ar: 'سجادة',            search: 'area rug',            weight: 7,  minEGP: 400,  big: false, rooms: ['living_room', 'bedroom', 'kids_room', 'dining_room'] },
  curtains:      { en: 'Curtains',        ar: 'ستائر',            search: 'curtains pair',       weight: 5,  minEGP: 300,  big: false, rooms: ['living_room', 'bedroom', 'kids_room', 'home_office', 'dining_room'] },
  floor_lamp:    { en: 'Floor lamp',      ar: 'أباجورة أرضية',    search: 'floor lamp',          weight: 4,  minEGP: 400,  big: false, rooms: ['living_room', 'bedroom', 'home_office'] },
  table_lamp:    { en: 'Table lamp',      ar: 'أباجورة',          search: 'table lamp',          weight: 3,  minEGP: 250,  big: false, rooms: ['bedroom', 'living_room', 'home_office'] },
  ceiling_light: { en: 'Ceiling light',   ar: 'نجفة',             search: 'ceiling pendant light', weight: 5, minEGP: 300, big: false, rooms: ['living_room', 'bedroom', 'dining_room', 'kids_room'] },
  wall_art:      { en: 'Wall art',        ar: 'تابلوه',           search: 'framed wall art',     weight: 3,  minEGP: 150,  big: false, rooms: ['living_room', 'bedroom', 'home_office', 'dining_room'] },
  mirror:        { en: 'Mirror',          ar: 'مراية',            search: 'wall mirror',         weight: 3,  minEGP: 300,  big: false, rooms: ['bedroom', 'living_room'] },
  plant:         { en: 'Plant',           ar: 'زرع',              search: 'artificial plant pot', weight: 2, minEGP: 100,  big: false, rooms: ['living_room', 'bedroom', 'home_office'] },
  bed:           { en: 'Bed frame',       ar: 'سرير',             search: 'bed frame',           weight: 35, minEGP: 4000, big: true,  rooms: ['bedroom', 'kids_room'] },
  nightstand:    { en: 'Nightstand',      ar: 'كومودينو',         search: 'nightstand',          weight: 6,  minEGP: 600,  big: true,  rooms: ['bedroom'] },
  wardrobe:      { en: 'Wardrobe',        ar: 'دولاب',            search: 'wardrobe',            weight: 25, minEGP: 4000, big: true,  rooms: ['bedroom', 'kids_room'] },
  dresser:       { en: 'Dresser',         ar: 'تسريحة',           search: 'chest of drawers',    weight: 12, minEGP: 2000, big: true,  rooms: ['bedroom'] },
  bedding:       { en: 'Bedding set',     ar: 'طقم مفارش',        search: 'duvet cover set',     weight: 4,  minEGP: 400,  big: false, rooms: ['bedroom', 'kids_room'] },
  desk:          { en: 'Desk',            ar: 'مكتب',             search: 'desk',                weight: 20, minEGP: 1500, big: true,  rooms: ['home_office', 'bedroom', 'kids_room'] },
  office_chair:  { en: 'Office chair',    ar: 'كرسي مكتب',        search: 'office chair',        weight: 12, minEGP: 1200, big: true,  rooms: ['home_office'] },
  dining_table:  { en: 'Dining table',    ar: 'ترابيزة سفرة',     search: 'dining table',        weight: 30, minEGP: 3000, big: true,  rooms: ['dining_room'] },
  dining_chair:  { en: 'Dining chairs',   ar: 'كراسي سفرة',       search: 'dining chair',        weight: 15, minEGP: 600,  big: true,  rooms: ['dining_room'] },
  sideboard:     { en: 'Sideboard',       ar: 'بوفيه',            search: 'sideboard',           weight: 15, minEGP: 2500, big: true,  rooms: ['dining_room', 'living_room'] }
};

// Sensible starting lists when the user has no specific items in mind
const DEFAULT_ITEMS = {
  living_room: ['sofa', 'coffee_table', 'rug', 'floor_lamp', 'curtains', 'wall_art'],
  bedroom: ['bed', 'nightstand', 'wardrobe', 'rug', 'table_lamp', 'curtains'],
  home_office: ['desk', 'office_chair', 'bookshelf', 'table_lamp', 'rug'],
  dining_room: ['dining_table', 'dining_chair', 'sideboard', 'ceiling_light', 'rug'],
  kids_room: ['bed', 'wardrobe', 'desk', 'rug', 'curtains'],
  other: ['sofa', 'rug', 'floor_lamp', 'wall_art']
};

const ITEM_KEYS = Object.keys(ITEMS);

function itemLabel(key, lang = 'en') {
  const item = ITEMS[key];
  if (!item) return key;
  return lang === 'ar' ? item.ar : item.en;
}

module.exports = { ITEMS, ITEM_KEYS, DEFAULT_ITEMS, itemLabel };
