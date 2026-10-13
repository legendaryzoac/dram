/**
 * Pairing, layer 1: pure, deterministic, no network. The `#/pair` tab asks
 * two kinds of question —
 *
 *   "I'm having the steak — what should I order, or pour?"
 *   "I'm lighting a cigar — what goes with it?"
 *
 * — and both resolve to the same shape, an Occasion: a *target* flavor
 * profile on the eight shared axes (what the ideal drink tastes like), per-type
 * *affinities* (how classically each category pairs), a line on *why*, and a
 * few *order* suggestions for when the drink comes off a menu instead of the
 * cabinet. The cabinet is then ranked against the target with the same cosine
 * math the recommender uses, blended with affinity and the drinker's own
 * ratings, so the picks lean toward what they already love.
 *
 * Layer 2 (the narrated take, Haiku via POST /pairings) runs only when the
 * drinker submits a pairing; nothing here calls the network.
 */
import type { Bottle, CigarStrength, FlavorTags } from './types'
import { FLAVOR_AXES, canonicalType, familyOf, onShelf, typeGroupOf } from './types'
import { capitalize, cosine, flavorVector, sharedFlavors } from './recommend'

// ---- shapes ----

export interface OrderSuggestion {
  /** "a structured red — Cabernet Sauvignon, Malbec, Syrah" */
  text: string
  /** Types or group ids this covers, so a loved bottle of the kind can be cited. */
  types: string[]
}

export interface Occasion {
  id: string
  /** Heading: "Steak & red meat". */
  label: string
  /** For prose: "steak" → "a classic with steak". */
  short: string
  /** The ideal drink on the eight axes; null when the dish is unknown. */
  target: FlavorTags | null
  /** Type or group id → 0..1, how classically it pairs. Unlisted types score
   *  0; `other` and free-form types score a neutral NEUTRAL_AFFINITY. */
  affinity: Record<string, number>
  why: string
  order: OrderSuggestion[]
}

export interface FoodOccasion extends Occasion {
  /** Lowercase words/phrases matched against the typed dish. */
  keywords: string[]
}

const F = (
  sweet: number,
  fruity: number,
  floral: number,
  acidity: number,
  body: number,
  oaky: number,
  smoky: number,
  spicy: number,
): FlavorTags => ({ sweet, fruity, floral, acidity, body, oaky, smoky, spicy })

// ---- food ----

/**
 * The dishes dram knows. Matching picks the occasion with the most specific
 * (longest) matching keyword, so "fish and chips" lands on seafood rather
 * than fried, and "blue cheese" beats "cheese". Order here only breaks ties.
 */
export const FOOD_OCCASIONS: readonly FoodOccasion[] = [
  {
    id: 'steak',
    label: 'Steak & red meat',
    short: 'steak',
    keywords: [
      'steak', 'ribeye', 'rib eye', 'filet', 'fillet', 'sirloin', 'strip steak',
      'new york strip', 'porterhouse', 't-bone', 'tomahawk', 'wagyu', 'prime rib',
      'roast beef', 'pot roast', 'beef', 'lamb', 'venison', 'elk', 'bison',
      'burger', 'hamburger', 'cheeseburger', 'short rib', 'meatball', 'red meat',
    ],
    target: F(2, 3, 0, 2, 5, 4, 2, 3),
    affinity: {
      'red wine': 1, bourbon: 0.85, rye: 0.75, scotch: 0.7, 'american whiskey': 0.65,
      'tennessee whiskey': 0.6, whisky: 0.5, armagnac: 0.55, cognac: 0.5, brandy: 0.4,
      mezcal: 0.4, rum: 0.35, 'fortified wine': 0.3, amaro: 0.3,
    },
    why: 'Fat and char want tannin, body, and oak — a drink that can stand up to the plate.',
    order: [
      { text: 'a structured red — Cabernet Sauvignon, Malbec, Syrah, or a Bordeaux blend', types: ['red wine'] },
      { text: 'a high-proof bourbon or rye, neat or in an Old Fashioned', types: ['bourbon', 'rye', 'american whiskey', 'tennessee whiskey'] },
      { text: 'a sherry-cask or gently peated Scotch', types: ['scotch'] },
    ],
  },
  {
    id: 'barbecue',
    label: 'Barbecue & smoked meats',
    short: 'barbecue',
    keywords: [
      'bbq', 'barbecue', 'barbeque', 'ribs', 'baby back', 'pulled pork', 'brisket',
      'smoked', 'burnt ends', 'sausage', 'bratwurst', 'hot dog', 'smokehouse',
    ],
    target: F(4, 3, 0, 2, 4, 4, 3, 3),
    affinity: {
      bourbon: 1, 'tennessee whiskey': 0.9, rye: 0.8, 'american whiskey': 0.8, mezcal: 0.75,
      'red wine': 0.7, rum: 0.65, scotch: 0.5, whisky: 0.5, tequila: 0.45, cachaça: 0.4,
      brandy: 0.35, 'fortified wine': 0.3,
    },
    why: 'Sweet smoke and spice rub meet their match in caramel, oak, and a little fire.',
    order: [
      { text: 'a sweet, oaky bourbon — wheated or high-rye — or a Tennessee whiskey', types: ['bourbon', 'tennessee whiskey', 'american whiskey'] },
      { text: 'Zinfandel or a jammy Shiraz', types: ['red wine'] },
      { text: 'an aged rum, or a smoky mezcal if the sauce has heat', types: ['rum', 'mezcal'] },
    ],
  },
  {
    id: 'oysters',
    label: 'Oysters & the raw bar',
    short: 'oysters',
    keywords: [
      'oyster', 'raw bar', 'clam', 'ceviche', 'crudo', 'sashimi', 'sushi', 'nigiri',
      'poke', 'caviar', 'mussel', 'tartare', 'carpaccio',
    ],
    target: F(1, 3, 2, 5, 1, 0, 2, 1),
    affinity: {
      'sparkling wine': 1, 'white wine': 1, scotch: 0.6, gin: 0.6, 'japanese whisky': 0.55,
      vodka: 0.5, 'rosé wine': 0.5, 'fortified wine': 0.5, tequila: 0.4, vermouth: 0.3,
      whisky: 0.2, wine: 0.2,
    },
    why: 'Brine and sweetness want acidity and salinity — bubbles, a bone-dry white, or a whisper of peat.',
    order: [
      { text: 'Champagne, or a bone-dry white — Chablis, Muscadet, Albariño', types: ['sparkling wine', 'white wine'] },
      { text: 'a peated Islay malt — the briny classic with oysters', types: ['scotch'] },
      { text: 'a dry gin martini, or a Japanese whisky highball', types: ['gin', 'japanese whisky', 'vodka'] },
    ],
  },
  {
    id: 'seafood',
    label: 'Shellfish & white fish',
    short: 'seafood',
    keywords: [
      'shrimp', 'prawn', 'crab', 'lobster', 'scallop', 'halibut', 'cod', 'sole',
      'sea bass', 'branzino', 'snapper', 'grouper', 'tilapia', 'fish', 'seafood',
      'calamari', 'squid', 'octopus', 'paella', 'bouillabaisse', 'cioppino',
      'fish tacos', 'fish and chips', 'fish & chips', 'crab cake',
    ],
    target: F(2, 3, 2, 4, 2, 1, 0, 1),
    affinity: {
      'white wine': 1, 'sparkling wine': 0.8, 'rosé wine': 0.65, gin: 0.5,
      'japanese whisky': 0.5, irish: 0.45, tequila: 0.4, vodka: 0.35, scotch: 0.3,
      vermouth: 0.3, whisky: 0.25, 'red wine': 0.15,
    },
    why: 'Delicate and sweet — keep the drink bright and unoaked so the seafood stays in front.',
    order: [
      { text: 'a crisp white — Sauvignon Blanc, Albariño, Chablis — or a restrained Chardonnay for anything buttery', types: ['white wine'] },
      { text: 'a gin & tonic, or a whisky highball', types: ['gin', 'japanese whisky'] },
      { text: 'a light, unpeated malt — Irish, Lowland, or Japanese', types: ['irish', 'scotch', 'japanese whisky'] },
    ],
  },
  {
    id: 'rich-fish',
    label: 'Salmon & rich fish',
    short: 'salmon',
    keywords: [
      'salmon', 'tuna', 'trout', 'swordfish', 'mackerel', 'sardine', 'anchovy',
      'smoked salmon', 'lox', 'gravlax', 'eel', 'unagi', 'black cod', 'miso cod',
      'arctic char',
    ],
    target: F(2, 4, 2, 4, 3, 2, 1, 1),
    affinity: {
      'white wine': 0.9, 'rosé wine': 0.9, 'japanese whisky': 0.65, 'red wine': 0.6,
      'sparkling wine': 0.6, irish: 0.5, scotch: 0.45, 'fortified wine': 0.4, gin: 0.4,
      whisky: 0.3,
    },
    why: 'Oily fish has weight and sweetness — enough for a light red, a rosé, or a soft fruity malt.',
    order: [
      { text: 'Pinot Noir or a dry rosé', types: ['red wine', 'rosé wine'] },
      { text: 'an oaked Chardonnay or Viognier', types: ['white wine'] },
      { text: 'a soft, fruity single malt — Speyside or Japanese', types: ['scotch', 'japanese whisky'] },
    ],
  },
  {
    id: 'poultry-pork',
    label: 'Chicken, pork & roasts',
    short: 'the roast',
    keywords: [
      'chicken', 'roast chicken', 'rotisserie', 'turkey', 'roast turkey', 'pork',
      'pork chop', 'pork belly', 'roast pork', 'tenderloin', 'schnitzel', 'veal',
      'ham', 'porchetta', 'thanksgiving', 'katsu', 'tonkatsu', 'rabbit',
    ],
    target: F(3, 4, 1, 3, 3, 3, 1, 2),
    affinity: {
      'white wine': 0.85, calvados: 0.8, 'red wine': 0.7, 'rosé wine': 0.6, bourbon: 0.6,
      irish: 0.6, scotch: 0.55, 'japanese whisky': 0.55, cognac: 0.5, brandy: 0.5,
      'sparkling wine': 0.5, whisky: 0.45, rum: 0.4,
    },
    why: 'Mid-weight and savoury — round whites, light reds, and orchard-fruit spirits all fit.',
    order: [
      { text: 'a round white or a light red — Chardonnay, Chenin Blanc, Pinot Noir, Gamay', types: ['white wine', 'red wine'] },
      { text: 'an apple-toned Calvados, or a soft bourbon', types: ['calvados', 'bourbon'] },
      { text: 'a Speyside malt or an Irish pot-still whiskey', types: ['scotch', 'irish'] },
    ],
  },
  {
    id: 'duck-game',
    label: 'Duck & game birds',
    short: 'duck',
    keywords: [
      'duck', 'duck confit', 'confit', 'goose', 'quail', 'pheasant', 'squab',
      'game bird', 'wild boar', 'grouse', 'partridge',
    ],
    target: F(3, 5, 1, 3, 4, 3, 1, 2),
    affinity: {
      'red wine': 1, armagnac: 0.8, cognac: 0.65, scotch: 0.65, calvados: 0.6, bourbon: 0.5,
      rum: 0.5, brandy: 0.5, 'fortified wine': 0.45, whisky: 0.45,
    },
    why: 'Rich, dark meat with a fruit-friendly edge — Pinot Noir territory, or a sherried malt.',
    order: [
      { text: 'Pinot Noir — a Burgundy if they have it — or a mature Rioja', types: ['red wine'] },
      { text: 'a sherry-cask Speyside or Highland malt', types: ['scotch'] },
      { text: 'Armagnac or an aged rum', types: ['armagnac', 'rum'] },
    ],
  },
  {
    id: 'spicy',
    label: 'Spicy food',
    short: 'spicy food',
    keywords: [
      'spicy', 'hot', 'chili', 'chilli', 'curry', 'thai', 'sichuan', 'szechuan',
      'indian', 'vindaloo', 'tikka masala', 'buffalo', 'hot wings', 'wings', 'jerk',
      'kimchi', 'korean', 'laksa', 'pad thai', 'green curry', 'red curry', 'massaman',
      'nashville', 'cajun', 'jambalaya', 'gumbo', 'mapo', 'kung pao', 'hunan',
      'harissa', 'peri peri', 'piri piri', 'hot pot', 'bulgogi', 'tandoori', 'biryani',
    ],
    target: F(4, 4, 2, 3, 2, 1, 1, 1),
    affinity: {
      'white wine': 0.9, 'rosé wine': 0.7, 'sparkling wine': 0.6, tequila: 0.6, mezcal: 0.55,
      rum: 0.55, 'japanese whisky': 0.55, gin: 0.5, 'dessert wine': 0.4, irish: 0.4,
      vodka: 0.4, bourbon: 0.35, whisky: 0.3, 'red wine': 0.2,
    },
    why: 'Capsaicin amplifies alcohol and tannin; a touch of sugar, bubbles, and dilution cool it down.',
    order: [
      { text: 'an off-dry Riesling or Gewürztraminer — a little sugar cools the heat', types: ['white wine'] },
      { text: 'a tall, cold highball — Japanese whisky and soda, or a Paloma', types: ['japanese whisky', 'tequila'] },
      { text: 'a lightly sweet aged rum, or a reposado', types: ['rum', 'tequila'] },
    ],
  },
  {
    id: 'mexican',
    label: 'Tacos & Mexican',
    short: 'tacos',
    keywords: [
      'taco', 'burrito', 'enchilada', 'al pastor', 'birria', 'carnitas', 'mole',
      'quesadilla', 'mexican', 'elote', 'taqueria', 'fajita', 'carne asada',
      'barbacoa', 'tamale', 'nacho', 'guacamole', 'tostada',
    ],
    target: F(3, 4, 1, 4, 3, 1, 2, 3),
    affinity: {
      tequila: 1, mezcal: 1, 'white wine': 0.5, 'rosé wine': 0.5, rum: 0.4,
      'sparkling wine': 0.4, 'red wine': 0.3, gin: 0.3, bourbon: 0.3, whisky: 0.2,
    },
    why: 'Lime, chili, and char: agave spirits are the home team — a Paloma or a sipping mezcal.',
    order: [
      { text: 'a blanco tequila in a Paloma or a margarita', types: ['tequila'] },
      { text: 'a sipping mezcal — smoke meets char', types: ['mezcal'] },
      { text: 'a dry rosé, or an off-dry Riesling if it’s fiery', types: ['rosé wine', 'white wine'] },
    ],
  },
  {
    id: 'asian',
    label: 'Noodles, dumplings & stir-fry',
    short: 'the noodles',
    keywords: [
      'ramen', 'pho', 'noodle', 'dumpling', 'dim sum', 'stir fry', 'stir-fry',
      'fried rice', 'lo mein', 'chow mein', 'bao', 'gyoza', 'wonton', 'bibimbap',
      'teriyaki', 'yakitori', 'izakaya', 'udon', 'soba', 'tempura', 'banh mi',
      'spring roll', 'egg roll', 'peking',
    ],
    target: F(3, 3, 1, 3, 2, 1, 1, 2),
    affinity: {
      'japanese whisky': 0.8, 'white wine': 0.75, 'sparkling wine': 0.6, gin: 0.5,
      'rosé wine': 0.5, irish: 0.4, whisky: 0.35, rum: 0.35, bourbon: 0.3, 'red wine': 0.2,
    },
    why: 'Soy, ginger, and broth: a whisky highball is the house pairing, or an aromatic white.',
    order: [
      { text: 'a Japanese whisky highball — the izakaya classic', types: ['japanese whisky'] },
      { text: 'an aromatic white — Riesling, Gewürztraminer, Pinot Gris', types: ['white wine'] },
      { text: 'a gin & tonic with a twist of ginger', types: ['gin'] },
    ],
  },
  {
    id: 'italian',
    label: 'Pasta, pizza & tomato',
    short: 'the pasta',
    keywords: [
      'pasta', 'pizza', 'tomato', 'bolognese', 'lasagna', 'lasagne', 'marinara',
      'ragù', 'ragu', 'italian', 'spaghetti', 'rigatoni', 'penne', 'gnocchi',
      'carbonara', 'cacio e pepe', 'parmigiana', 'eggplant parm', 'chicken parm',
      'margherita', 'pepperoni', 'calzone', 'osso buco', 'risotto', 'amatriciana',
    ],
    target: F(2, 4, 1, 4, 3, 2, 0, 2),
    affinity: {
      'red wine': 1, amaro: 0.6, 'rosé wine': 0.5, 'white wine': 0.45, vermouth: 0.45,
      'sparkling wine': 0.4, gin: 0.35, brandy: 0.3, wine: 0.3, whisky: 0.2,
    },
    why: 'Tomato acidity needs a wine with matching acid and moderate tannin; soft, low-acid reds fall flat.',
    order: [
      { text: 'a high-acid Italian red — Chianti, Barbera, Montepulciano, Nero d’Avola', types: ['red wine'] },
      { text: 'a Negroni before, an amaro after', types: ['gin', 'vermouth', 'amaro'] },
      { text: 'Pinot Grigio or Vermentino if it’s a white sauce or seafood pasta', types: ['white wine'] },
    ],
  },
  {
    id: 'earthy',
    label: 'Mushrooms, truffle & braises',
    short: 'earthy dishes',
    keywords: [
      'mushroom', 'truffle', 'porcini', 'morel', 'chanterelle', 'umami', 'miso',
      'braise', 'braised', 'stew', 'beef stew', 'boeuf bourguignon', 'bourguignon',
      'coq au vin', 'cassoulet', 'french onion', 'lentil', 'bean', 'shepherd',
      'cottage pie', 'goulash', 'tagine',
    ],
    target: F(2, 3, 1, 3, 3, 3, 1, 1),
    affinity: {
      'red wine': 1, 'fortified wine': 0.65, scotch: 0.65, 'japanese whisky': 0.6,
      armagnac: 0.55, cognac: 0.5, 'white wine': 0.5, whisky: 0.45, brandy: 0.45,
      amaro: 0.4, rum: 0.35,
    },
    why: 'Earth and umami love savoury, aged flavours — mature reds, dry sherry, old oak.',
    order: [
      { text: 'an earthy red — Pinot Noir, Nebbiolo, aged Rioja', types: ['red wine'] },
      { text: 'a dry sherry — Fino or Amontillado', types: ['fortified wine'] },
      { text: 'an old sherry-cask Scotch or a Japanese malt', types: ['scotch', 'japanese whisky'] },
    ],
  },
  {
    id: 'blue-cheese',
    label: 'Blue cheese',
    short: 'blue cheese',
    keywords: ['blue cheese', 'stilton', 'roquefort', 'gorgonzola', 'cambozola', 'bleu'],
    target: F(5, 4, 1, 2, 4, 3, 1, 1),
    affinity: {
      'fortified wine': 1, 'dessert wine': 1, bourbon: 0.6, rum: 0.6, scotch: 0.55,
      cognac: 0.5, armagnac: 0.5, brandy: 0.45, whisky: 0.4, liqueur: 0.4, 'red wine': 0.35,
    },
    why: 'Salt meets sweet: the textbook pairing is a sweet wine with enough body to match the funk.',
    order: [
      { text: 'Port or Sauternes — salt-and-sweet, the textbook match', types: ['fortified wine', 'dessert wine'] },
      { text: 'an aged rum or a sherried Scotch', types: ['rum', 'scotch'] },
      { text: 'a wheated bourbon', types: ['bourbon'] },
    ],
  },
  {
    id: 'cheese',
    label: 'Cheese board',
    short: 'cheese',
    keywords: [
      'cheese', 'cheese board', 'cheeseboard', 'brie', 'camembert', 'cheddar', 'gouda',
      'parmesan', 'parmigiano', 'manchego', 'gruyère', 'gruyere', 'comté', 'comte',
      'alpine', 'pecorino', 'goat cheese', 'chèvre', 'chevre', 'fondue', 'raclette',
      'mac and cheese', 'mac & cheese', 'grilled cheese', 'burrata', 'mozzarella',
      'halloumi', 'taleggio', 'époisses', 'epoisses',
    ],
    target: F(3, 4, 1, 3, 3, 3, 1, 1),
    affinity: {
      'fortified wine': 0.85, 'red wine': 0.8, 'white wine': 0.7, scotch: 0.7, calvados: 0.7,
      'sparkling wine': 0.65, cognac: 0.6, brandy: 0.55, armagnac: 0.55, bourbon: 0.5,
      irish: 0.5, whisky: 0.5, 'dessert wine': 0.5, rum: 0.4,
    },
    why: 'Nutty, salty, and fatty — oxidative sherry, nutty oak, and bubbles all cut through.',
    order: [
      { text: 'Champagne with soft-ripened cheeses; a structured red or an oxidative sherry with aged hard ones', types: ['sparkling wine', 'red wine', 'fortified wine'] },
      { text: 'a Highland or Speyside malt — nutty oak meets nutty cheese', types: ['scotch'] },
      { text: 'Calvados or Cognac', types: ['calvados', 'cognac'] },
    ],
  },
  {
    id: 'chocolate',
    label: 'Chocolate',
    short: 'chocolate',
    keywords: ['chocolate', 'brownie', 'cocoa', 'fudge', 'ganache', 'lava cake', 'molten', 'mocha'],
    target: F(5, 3, 0, 1, 5, 4, 2, 2),
    affinity: {
      'fortified wine': 1, rum: 0.9, bourbon: 0.8, cognac: 0.7, armagnac: 0.7, scotch: 0.7,
      'dessert wine': 0.7, 'american whiskey': 0.6, 'tennessee whiskey': 0.6, amaro: 0.6,
      liqueur: 0.6, brandy: 0.6, whisky: 0.5, 'red wine': 0.4, mezcal: 0.4, cachaça: 0.4,
    },
    why: 'Bitter-sweet and heavy: it wants a drink at least as sweet, with dark fruit, caramel, or smoke.',
    order: [
      { text: 'Tawny Port, PX sherry, or Banyuls', types: ['fortified wine', 'dessert wine'] },
      { text: 'an aged rum or a wheated bourbon', types: ['rum', 'bourbon'] },
      { text: 'a sherried or richly peated Scotch', types: ['scotch'] },
    ],
  },
  {
    id: 'dessert',
    label: 'Dessert',
    short: 'dessert',
    keywords: [
      'dessert', 'cake', 'tart', 'pie', 'crème brûlée', 'creme brulee', 'cheesecake',
      'ice cream', 'gelato', 'sorbet', 'pudding', 'pavlova', 'panna cotta', 'tiramisu',
      'cookie', 'pastry', 'pastries', 'crumble', 'cobbler', 'apple pie', 'macaron',
      'baklava', 'churros', 'donut', 'doughnut', 'custard', 'meringue', 'fruit',
      'berries', 'strawberries', 'peaches', 'affogato', 'cannoli', 'sticky toffee',
    ],
    target: F(5, 4, 2, 3, 3, 2, 0, 1),
    affinity: {
      'dessert wine': 1, 'fortified wine': 0.75, 'sparkling wine': 0.7, liqueur: 0.7,
      calvados: 0.65, cognac: 0.6, brandy: 0.55, rum: 0.5, armagnac: 0.5, bourbon: 0.45,
      irish: 0.45, amaro: 0.4, whisky: 0.35, 'white wine': 0.3,
    },
    why: 'The drink should be sweeter than the dessert, or it will taste thin and sour beside it.',
    order: [
      { text: 'Sauternes, Moscato d’Asti, or a late-harvest Riesling', types: ['dessert wine', 'sparkling wine'] },
      { text: 'Cognac or Calvados', types: ['cognac', 'calvados'] },
      { text: 'a liqueur, or a creamy Irish whiskey', types: ['liqueur', 'irish'] },
    ],
  },
  {
    id: 'charcuterie',
    label: 'Charcuterie & tapas',
    short: 'charcuterie',
    keywords: [
      'charcuterie', 'prosciutto', 'salami', 'jamón', 'jamon', 'iberico', 'ibérico',
      'serrano', 'cured', 'terrine', 'antipasti', 'antipasto', 'tapas', 'olives',
      'bresaola', 'coppa', 'soppressata', 'mortadella', 'chorizo', 'nduja', 'pintxos',
      'meze', 'mezze', 'aperitivo',
    ],
    target: F(2, 4, 1, 4, 3, 1, 1, 2),
    affinity: {
      'fortified wine': 0.9, 'rosé wine': 0.8, 'sparkling wine': 0.8, 'red wine': 0.8,
      vermouth: 0.7, 'white wine': 0.6, amaro: 0.45, gin: 0.4, brandy: 0.3, whisky: 0.25,
    },
    why: 'Salt and fat on small plates: salty sherry, chilled light reds, bubbles, and bitter aperitivi.',
    order: [
      { text: 'Fino or Manzanilla sherry — salt on salt', types: ['fortified wine'] },
      { text: 'a chilled light red or a dry rosé — Beaujolais, Lambrusco', types: ['red wine', 'rosé wine', 'sparkling wine'] },
      { text: 'a vermouth on the rocks, or a spritz', types: ['vermouth', 'amaro'] },
    ],
  },
  {
    id: 'fried',
    label: 'Fried & salty',
    short: 'fried food',
    keywords: [
      'fried', 'fries', 'french fries', 'fried chicken', 'chips', 'crisps', 'popcorn',
      'onion rings', 'croquette', 'karaage', 'fritto misto', 'arancini', 'samosa',
      'tater tots', 'bar snacks', 'pretzel', 'nuts', 'peanuts', 'potato chips',
    ],
    target: F(2, 3, 1, 5, 2, 0, 0, 1),
    affinity: {
      'sparkling wine': 1, 'white wine': 0.7, 'japanese whisky': 0.6, gin: 0.55,
      'rosé wine': 0.55, tequila: 0.5, vodka: 0.45, bourbon: 0.4, irish: 0.4, rum: 0.35,
      whisky: 0.3,
    },
    why: 'Fat and salt want acid and bubbles to scrub the palate between bites.',
    order: [
      { text: 'Champagne or any dry sparkling — bubbles and acid cut the fat', types: ['sparkling wine'] },
      { text: 'a highball or a gin & tonic', types: ['japanese whisky', 'gin'] },
      { text: 'a crisp white — Albariño, Grüner Veltliner', types: ['white wine'] },
    ],
  },
  {
    id: 'greens',
    label: 'Salads & vegetables',
    short: 'the greens',
    keywords: [
      'salad', 'vegetable', 'veggie', 'vegetarian', 'vegan', 'greens', 'asparagus',
      'artichoke', 'zucchini', 'courgette', 'broccoli', 'kale', 'spinach', 'caesar',
      'caprese', 'tabbouleh', 'crudités', 'crudites', 'grain bowl', 'buddha bowl',
      'ratatouille', 'hummus', 'falafel', 'tofu', 'edamame', 'cucumber', 'beet',
      'squash', 'pumpkin', 'cauliflower', 'eggplant', 'aubergine', 'avocado',
    ],
    target: F(1, 4, 3, 5, 1, 0, 0, 1),
    affinity: {
      'white wine': 1, 'rosé wine': 0.7, 'sparkling wine': 0.6, gin: 0.6, vermouth: 0.5,
      'japanese whisky': 0.35, vodka: 0.3, 'red wine': 0.25, whisky: 0.15,
    },
    why: 'Green, bitter, and acidic: match it with herbal, high-acid drinks and keep oak away.',
    order: [
      { text: 'Sauvignon Blanc or Grüner Veltliner — green with green', types: ['white wine'] },
      { text: 'a dry rosé or a light sparkling', types: ['rosé wine', 'sparkling wine'] },
      { text: 'a gin & tonic, or a dry vermouth with soda', types: ['gin', 'vermouth'] },
    ],
  },
  {
    id: 'brunch',
    label: 'Brunch & breakfast',
    short: 'brunch',
    keywords: [
      'brunch', 'breakfast', 'eggs', 'omelette', 'omelet', 'benedict', 'pancake',
      'waffle', 'french toast', 'bacon', 'quiche', 'frittata', 'shakshuka', 'bagel',
      'croissant', 'hash',
    ],
    target: F(3, 4, 2, 4, 2, 1, 1, 1),
    affinity: {
      'sparkling wine': 1, vodka: 0.5, irish: 0.5, 'white wine': 0.5, 'rosé wine': 0.5,
      gin: 0.45, liqueur: 0.4, bourbon: 0.3, whisky: 0.2,
    },
    why: 'Daytime drinking wants lift, not weight — bubbles, a Bloody Mary, or a splash in the coffee.',
    order: [
      { text: 'Champagne or Cava — a mimosa if you must', types: ['sparkling wine'] },
      { text: 'a Bloody Mary', types: ['vodka', 'gin'] },
      { text: 'an Irish coffee', types: ['irish'] },
    ],
  },
]

/** The fallback when nothing matched: rank on ratings alone and say so. */
export const UNKNOWN_OCCASION: Occasion = {
  id: 'unknown',
  label: 'Not sure what that is',
  short: 'it',
  target: null,
  affinity: {},
  why: 'dram doesn’t know that dish yet, so these are simply your best-rated bottles. Try naming the main ingredient, the sauce, or how spicy it is — or pick the closest category.',
  order: [],
}

/** Strip accents, lowercase, and collapse everything non-alphanumeric to one
 *  space, so "Crème brûlée!" and "creme brulee" compare equal. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const keywordPatterns = new Map<string, RegExp>()

/** Whole-word match with a forgiving plural ("oyster" also hits "oysters"). */
function keywordPattern(keyword: string): RegExp {
  let re = keywordPatterns.get(keyword)
  if (!re) {
    const escaped = normalizeText(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`\\b${escaped}(?:es|s)?\\b`)
    keywordPatterns.set(keyword, re)
  }
  return re
}

/**
 * The occasion whose most specific keyword appears in the text. Specificity
 * is keyword length — a longer phrase names the dish more exactly — with
 * earliest mention breaking ties. Null when nothing is recognised.
 */
export function matchFood(text: string): FoodOccasion | null {
  const q = normalizeText(text)
  if (!q) return null
  let best: { occasion: FoodOccasion; length: number; at: number } | null = null
  for (const occasion of FOOD_OCCASIONS) {
    for (const keyword of occasion.keywords) {
      const m = keywordPattern(keyword).exec(q)
      if (!m) continue
      const length = keyword.length
      if (
        !best ||
        length > best.length ||
        (length === best.length && m.index < best.at)
      ) {
        best = { occasion, length, at: m.index }
      }
    }
  }
  return best?.occasion ?? null
}

export function foodOccasion(id: string): FoodOccasion | undefined {
  return FOOD_OCCASIONS.find((o) => o.id === id)
}

// ---- cigars ----

export const WRAPPERS = [
  'connecticut',
  'habano',
  'corojo',
  'cameroon',
  'sumatra',
  'maduro',
  'oscuro',
  'candela',
] as const
export type Wrapper = (typeof WRAPPERS)[number]

/** Words in a brand/line that imply a wrapper. First match wins, so the
 *  dark leaves sit first: "Connecticut Broadleaf" is a maduro leaf grown in
 *  Connecticut, not the shade-grown wrapper the state's name usually means. */
const WRAPPER_WORDS: Array<[string, Wrapper]> = [
  ['connecticut broadleaf', 'maduro'],
  ['broadleaf', 'maduro'],
  ['san andres', 'maduro'],
  ['maduro', 'maduro'],
  ['oscuro', 'oscuro'],
  ['connecticut', 'connecticut'],
  ['shade', 'connecticut'],
  ['claro', 'connecticut'],
  ['habano', 'habano'],
  ['rosado', 'habano'],
  ['colorado', 'habano'],
  ['corojo', 'corojo'],
  ['cameroon', 'cameroon'],
  ['sumatra', 'sumatra'],
  ['candela', 'candela'],
]

/** Words in a brand/line that imply strength. */
const STRENGTH_WORDS: Array<[string, CigarStrength]> = [
  ['mild', 'mild'],
  ['light', 'mild'],
  ['medium', 'medium'],
  ['full', 'full'],
  ['ligero', 'full'],
  ['fuerte', 'full'],
  ['strong', 'full'],
  ['bold', 'full'],
]

export interface CigarBrand {
  /** Lowercase substrings looked for in the brand + line text. */
  match: string[]
  name: string
  strength: CigarStrength
  wrapper?: Wrapper
  /** Flavor shorthand: what the smoke is known for. */
  notes: string
}

/**
 * Well-known marques and lines. First match wins, so specific lines sit
 * above their house. Strength is the pairing lever; wrapper refines it.
 */
export const CIGAR_BRANDS: readonly CigarBrand[] = [
  { match: ['opus x', 'opusx'], name: 'Fuente Fuente OpusX', strength: 'full', wrapper: 'habano', notes: 'red pepper, cedar, leather, cream' },
  { match: ['hemingway'], name: 'Arturo Fuente Hemingway', strength: 'medium', wrapper: 'cameroon', notes: 'cedar, sweet spice, toasted nuts' },
  { match: ['don carlos'], name: 'Arturo Fuente Don Carlos', strength: 'medium', wrapper: 'cameroon', notes: 'cedar, coffee, sweet spice' },
  { match: ['fuente'], name: 'Arturo Fuente', strength: 'medium', notes: 'cedar, nuts, soft sweetness' },
  { match: ['padron', 'padrón'], name: 'Padrón', strength: 'full', notes: 'cocoa, espresso, cedar, black pepper' },
  { match: ['ashton vsg', 'virgin sun grown'], name: 'Ashton VSG', strength: 'full', wrapper: 'sumatra', notes: 'earth, pepper, dark coffee' },
  { match: ['ashton esg', 'ashton symmetry'], name: 'Ashton', strength: 'medium', notes: 'cedar, cream, sweet spice' },
  { match: ['ashton'], name: 'Ashton Classic', strength: 'mild', wrapper: 'connecticut', notes: 'cream, cedar, nuts' },
  { match: ['davidoff nicaragua'], name: 'Davidoff Nicaragua', strength: 'medium', wrapper: 'habano', notes: 'white pepper, cocoa, coffee' },
  { match: ['winston churchill'], name: 'Davidoff Winston Churchill', strength: 'medium', notes: 'cedar, leather, black tea' },
  { match: ['davidoff'], name: 'Davidoff', strength: 'mild', wrapper: 'connecticut', notes: 'cream, cedar, toasted nuts' },
  { match: ['macanudo inspirado'], name: 'Macanudo Inspirado', strength: 'medium', notes: 'earth, cocoa, cedar' },
  { match: ['macanudo'], name: 'Macanudo', strength: 'mild', wrapper: 'connecticut', notes: 'cream, cedar, a little honey' },
  { match: ['montecristo'], name: 'Montecristo', strength: 'medium', notes: 'cedar, cocoa, honey, pepper' },
  { match: ['behike'], name: 'Cohiba Behike', strength: 'full', notes: 'earth, cocoa, coffee, hay' },
  { match: ['cohiba'], name: 'Cohiba', strength: 'medium', notes: 'grass, honey, cedar, vanilla' },
  { match: ['romeo y julieta', 'romeo'], name: 'Romeo y Julieta', strength: 'medium', notes: 'cedar, cream, floral spice' },
  { match: ['partagas', 'partagás'], name: 'Partagás', strength: 'full', notes: 'earth, leather, pepper, coffee' },
  { match: ['bolivar', 'bolívar'], name: 'Bolívar', strength: 'full', notes: 'earth, dark chocolate, pepper' },
  { match: ['ramon allones', 'ramón allones'], name: 'Ramón Allones', strength: 'full', notes: 'dark fruit, leather, cocoa' },
  { match: ['hoyo de monterrey', 'hoyo'], name: 'Hoyo de Monterrey', strength: 'medium', notes: 'cream, nuts, light spice' },
  { match: ['upmann'], name: 'H. Upmann', strength: 'medium', notes: 'cedar, coffee, nuts' },
  { match: ['trinidad'], name: 'Trinidad', strength: 'medium', notes: 'cedar, cream, honey' },
  { match: ['punch'], name: 'Punch', strength: 'medium', notes: 'earth, cedar, pepper' },
  { match: ['por larranaga', 'por larrañaga'], name: 'Por Larrañaga', strength: 'mild', notes: 'caramel, cedar, hay' },
  { match: ['rafael gonzalez'], name: 'Rafael González', strength: 'mild', notes: 'cream, hay, cedar' },
  { match: ['quai d'], name: 'Quai d’Orsay', strength: 'mild', notes: 'hay, cream, mild spice' },
  { match: ['el rey del mundo'], name: 'El Rey del Mundo', strength: 'mild', notes: 'cream, cedar, floral' },
  { match: ['san cristobal'], name: 'San Cristóbal', strength: 'medium', notes: 'earth, cedar, sweet spice' },
  { match: ['vegas robaina'], name: 'Vegas Robaina', strength: 'medium', notes: 'earth, cocoa, cedar' },
  { match: ['juan lopez'], name: 'Juan López', strength: 'medium', notes: 'cedar, coffee, pepper' },
  { match: ['saint luis rey'], name: 'Saint Luis Rey', strength: 'medium', notes: 'earth, cocoa, leather' },
  { match: ['la gloria cubana'], name: 'La Gloria Cubana', strength: 'medium', notes: 'earth, cedar, sweet spice' },
  { match: ['sancho panza'], name: 'Sancho Panza', strength: 'medium', notes: 'cedar, earth, mild spice' },
  { match: ['serie v', 'oliva v'], name: 'Oliva Serie V', strength: 'full', wrapper: 'habano', notes: 'dark chocolate, pepper, coffee' },
  { match: ['oliva connecticut'], name: 'Oliva Connecticut Reserve', strength: 'mild', wrapper: 'connecticut', notes: 'cream, cedar, nuts' },
  { match: ['oliva'], name: 'Oliva', strength: 'medium', notes: 'cedar, cocoa, pepper' },
  { match: ['le bijou'], name: 'My Father Le Bijou 1922', strength: 'full', wrapper: 'oscuro', notes: 'dark cocoa, pepper, leather' },
  { match: ['flor de las antillas'], name: 'My Father Flor de las Antillas', strength: 'medium', notes: 'cedar, cocoa, baking spice' },
  { match: ['my father'], name: 'My Father', strength: 'full', wrapper: 'habano', notes: 'pepper, cocoa, leather, coffee' },
  { match: ['liga privada'], name: 'Liga Privada', strength: 'full', wrapper: 'maduro', notes: 'dark chocolate, espresso, earth' },
  { match: ['undercrown shade'], name: 'Undercrown Shade', strength: 'mild', wrapper: 'connecticut', notes: 'cream, cedar, white pepper' },
  { match: ['undercrown'], name: 'Undercrown', strength: 'medium', wrapper: 'maduro', notes: 'cocoa, espresso, cedar' },
  { match: ['kentucky fire cured', 'fire cured'], name: 'Kentucky Fire Cured', strength: 'full', notes: 'campfire, barbecue smoke, sweet tobacco' },
  { match: ['herrera esteli'], name: 'Herrera Estelí', strength: 'medium', wrapper: 'habano', notes: 'cedar, pepper, caramel' },
  { match: ['nica rustica'], name: 'Nica Rustica', strength: 'full', wrapper: 'maduro', notes: 'earth, cocoa, black pepper' },
  { match: ['acid ', 'acid blondie', 'acid kuba'], name: 'ACID', strength: 'mild', notes: 'infused — floral, sweet, herbal' },
  { match: ['tabak'], name: 'Tabak Especial', strength: 'mild', notes: 'infused — coffee, cream, cocoa' },
  { match: ['java'], name: 'Java', strength: 'mild', notes: 'infused — mocha, vanilla, cream' },
  { match: ['drew estate'], name: 'Drew Estate', strength: 'medium', notes: 'cocoa, cedar, pepper' },
  { match: ['rocky patel'], name: 'Rocky Patel', strength: 'medium', notes: 'cedar, cocoa, baking spice' },
  { match: ['perdomo'], name: 'Perdomo', strength: 'medium', notes: 'cedar, caramel, nuts' },
  { match: ['camacho connecticut'], name: 'Camacho Connecticut', strength: 'mild', wrapper: 'connecticut', notes: 'cream, nuts, cedar' },
  { match: ['camacho'], name: 'Camacho', strength: 'full', wrapper: 'corojo', notes: 'pepper, earth, leather' },
  { match: ['cao brazilia'], name: 'CAO Brazilia', strength: 'full', notes: 'earth, cocoa, pepper' },
  { match: ['cao'], name: 'CAO', strength: 'medium', notes: 'cedar, cocoa, sweet spice' },
  { match: ['prensado'], name: 'Alec Bradley Prensado', strength: 'full', wrapper: 'corojo', notes: 'earth, dark chocolate, pepper' },
  { match: ['alec bradley'], name: 'Alec Bradley', strength: 'medium', notes: 'cedar, cocoa, baking spice' },
  { match: ['double ligero', 'la flor dominicana', 'lfd'], name: 'La Flor Dominicana', strength: 'full', notes: 'pepper, earth, dark cocoa' },
  { match: ['new world', 'aj fernandez', 'a.j. fernandez'], name: 'AJ Fernandez', strength: 'medium', notes: 'cocoa, pepper, cedar' },
  { match: ['alma fuerte'], name: 'Plasencia Alma Fuerte', strength: 'full', notes: 'earth, cocoa, black pepper' },
  { match: ['plasencia'], name: 'Plasencia', strength: 'medium', notes: 'cedar, cocoa, sweet spice' },
  { match: ['tatuaje'], name: 'Tatuaje', strength: 'full', notes: 'pepper, earth, cedar' },
  { match: ['illusione'], name: 'Illusione', strength: 'medium', notes: 'cedar, cream, white pepper' },
  { match: ['aging room'], name: 'Aging Room', strength: 'medium', notes: 'cedar, cocoa, baking spice' },
  { match: ['crowned heads', 'four kicks'], name: 'Crowned Heads', strength: 'medium', notes: 'cedar, cream, pepper' },
  { match: ['diesel'], name: 'Diesel', strength: 'full', notes: 'earth, pepper, dark chocolate' },
  { match: ['nub'], name: 'Nub', strength: 'medium', notes: 'cedar, cocoa, pepper' },
  { match: ['gurkha'], name: 'Gurkha', strength: 'medium', notes: 'cedar, cocoa, sweet spice' },
  { match: ['joya de nicaragua', 'antano', 'antaño'], name: 'Joya de Nicaragua', strength: 'full', notes: 'earth, pepper, leather' },
  { match: ['la aroma de cuba'], name: 'La Aroma de Cuba', strength: 'medium', notes: 'cocoa, cedar, pepper' },
  { match: ['san lotano'], name: 'San Lotano', strength: 'medium', notes: 'cedar, cocoa, pepper' },
  { match: ['espinosa'], name: 'Espinosa', strength: 'full', notes: 'pepper, cocoa, earth' },
  { match: ['eiroa'], name: 'Eiroa', strength: 'full', notes: 'earth, pepper, cocoa' },
  { match: ['tabernacle'], name: 'Foundation Tabernacle', strength: 'full', wrapper: 'maduro', notes: 'dark chocolate, earth, pepper' },
  { match: ['foundation'], name: 'Foundation', strength: 'medium', notes: 'cedar, cocoa, spice' },
  { match: ['warped'], name: 'Warped', strength: 'medium', notes: 'cedar, cream, floral spice' },
  { match: ['viaje'], name: 'Viaje', strength: 'full', notes: 'pepper, earth, cocoa' },
  { match: ['black label trading', 'bltc'], name: 'Black Label Trading Co.', strength: 'full', notes: 'earth, pepper, dark cocoa' },
  { match: ['kristoff'], name: 'Kristoff', strength: 'medium', notes: 'cedar, cocoa, sweet spice' },
  { match: ['brick house'], name: 'Brick House', strength: 'medium', notes: 'cedar, pepper, earth' },
  { match: ['avo'], name: 'AVO', strength: 'mild', wrapper: 'connecticut', notes: 'cream, cedar, nuts' },
  { match: ['griffin'], name: 'Griffin’s', strength: 'mild', wrapper: 'connecticut', notes: 'cream, cedar, hay' },
  { match: ['zino'], name: 'Zino', strength: 'mild', notes: 'cream, cedar, mild spice' },
  { match: ['baccarat'], name: 'Baccarat', strength: 'mild', wrapper: 'connecticut', notes: 'sweet, cream, cedar' },
  { match: ['don pepin', 'pepin'], name: 'Don Pepín García', strength: 'full', notes: 'pepper, cedar, leather' },
]

export interface CigarInput {
  brand?: string
  line?: string
  /** Explicit strength; empty/undefined means "not sure" — infer it. */
  strength?: CigarStrength | ''
  /** Explicit wrapper; empty/undefined means "not sure" — infer it. */
  wrapper?: Wrapper | ''
}

export interface ResolvedCigar {
  strength: CigarStrength
  wrapper: Wrapper | null
  /** Where the strength came from, so the page can say "full — from the brand". */
  strengthSource: 'you' | 'the name' | 'the brand' | 'the default'
  /** The recognised marque, when the brand/line named one. */
  known: CigarBrand | null
  brand: string
  line: string
}

/** The known marque, if any, named by the typed brand/line. */
export function lookupCigarBrand(text: string): CigarBrand | null {
  const q = ` ${normalizeText(text)} `
  if (q.trim() === '') return null
  for (const b of CIGAR_BRANDS) {
    if (b.match.some((m) => q.includes(` ${normalizeText(m)}`))) return b
  }
  return null
}

/**
 * Settle strength and wrapper: what the drinker said wins, then words in the
 * name ("maduro", "ligero"), then the brand table, then a medium default.
 */
export function resolveCigar(input: CigarInput): ResolvedCigar {
  const brand = (input.brand ?? '').trim()
  const line = (input.line ?? '').trim()
  const text = normalizeText(`${brand} ${line}`)
  const known = lookupCigarBrand(text)

  const wordHit = <T,>(words: Array<[string, T]>): T | null => {
    for (const [word, value] of words) {
      if (keywordPattern(word).test(text)) return value
    }
    return null
  }

  let strength: CigarStrength
  let strengthSource: ResolvedCigar['strengthSource']
  const fromText = wordHit(STRENGTH_WORDS)
  if (input.strength) {
    strength = input.strength
    strengthSource = 'you'
  } else if (fromText) {
    strength = fromText
    strengthSource = 'the name'
  } else if (known) {
    strength = known.strength
    strengthSource = 'the brand'
  } else {
    strength = 'medium'
    strengthSource = 'the default'
  }

  const wrapper: Wrapper | null =
    input.wrapper || wordHit(WRAPPER_WORDS) || known?.wrapper || null

  return { strength, wrapper, strengthSource, known, brand, line }
}

type WrapperFamily = 'dark' | 'light' | 'spicy' | 'sweet-spice'

function wrapperFamily(w: Wrapper | null): WrapperFamily | null {
  switch (w) {
    case 'maduro':
    case 'oscuro':
      return 'dark'
    case 'connecticut':
    case 'candela':
      return 'light'
    case 'habano':
    case 'corojo':
      return 'spicy'
    case 'cameroon':
    case 'sumatra':
      return 'sweet-spice'
    default:
      return null
  }
}

const CIGAR_TARGET: Record<CigarStrength, FlavorTags> = {
  mild: F(3, 3, 2, 1, 3, 3, 1, 2),
  medium: F(3, 2, 1, 1, 4, 4, 2, 3),
  full: F(3, 2, 0, 1, 5, 4, 3, 3),
}

const WRAPPER_DELTA: Record<WrapperFamily, Partial<FlavorTags>> = {
  dark: { sweet: 1, smoky: 0.5, oaky: 0.5, fruity: -0.5 },
  light: { floral: 1, sweet: 0.5, body: -0.5, spicy: -0.5 },
  spicy: { spicy: 1, smoky: 0.5 },
  'sweet-spice': { sweet: 0.5, spicy: 0.5, fruity: 0.5 },
}

const CIGAR_AFFINITY: Record<CigarStrength, Record<string, number>> = {
  mild: {
    irish: 1, 'japanese whisky': 0.9, cognac: 0.9, scotch: 0.8, brandy: 0.7,
    'canadian whisky': 0.7, bourbon: 0.6, rum: 0.6, calvados: 0.6, 'world whisky': 0.6,
    'american whiskey': 0.5, 'fortified wine': 0.5, 'sparkling wine': 0.4, whisky: 0.5,
    liqueur: 0.4, amaro: 0.3, tequila: 0.3,
  },
  medium: {
    bourbon: 1, scotch: 0.9, rum: 0.9, cognac: 0.9, rye: 0.8, 'japanese whisky': 0.8,
    armagnac: 0.8, 'tennessee whiskey': 0.8, 'american whiskey': 0.8, irish: 0.7,
    'fortified wine': 0.7, brandy: 0.7, 'world whisky': 0.7, 'canadian whisky': 0.6,
    tequila: 0.6, cachaça: 0.5, amaro: 0.5, calvados: 0.5, 'red wine': 0.4, whisky: 0.6,
    mezcal: 0.5, liqueur: 0.3,
  },
  full: {
    scotch: 1, bourbon: 0.9, rye: 0.9, rum: 0.9, armagnac: 0.9, cognac: 0.8, mezcal: 0.8,
    'fortified wine': 0.8, 'american whiskey': 0.8, 'tennessee whiskey': 0.7, brandy: 0.7,
    'world whisky': 0.7, 'japanese whisky': 0.6, tequila: 0.6, amaro: 0.6, 'red wine': 0.5,
    'canadian whisky': 0.5, irish: 0.4, cachaça: 0.4, calvados: 0.4, whisky: 0.6,
  },
}

const WRAPPER_BUMP: Record<WrapperFamily, string[]> = {
  dark: ['rum', 'fortified wine', 'bourbon', 'amaro'],
  light: ['irish', 'cognac', 'japanese whisky', 'canadian whisky'],
  spicy: ['rye', 'scotch', 'tequila', 'mezcal'],
  'sweet-spice': ['bourbon', 'cognac', 'rum'],
}

const CIGAR_WHY: Record<CigarStrength, string> = {
  mild: 'A mild smoke is easily bulldozed — keep the drink soft, fruity, and gentle in proof.',
  medium: 'Medium strength is the sweet spot: caramel, oak, and dried fruit mirror the cigar without fighting it.',
  full: 'A full-bodied cigar swallows delicate drinks — meet it with proof, smoke, or sherry-cask weight.',
}

const WRAPPER_WHY: Record<WrapperFamily, string> = {
  dark: 'The dark wrapper brings cocoa and espresso, which aged rum, Port, and bourbon echo.',
  light: 'A Connecticut-style wrapper is creamy and cedar-y; Irish, Speyside, and Cognac stay in step.',
  spicy: 'Habano leaf is peppery — rye and sherried Highland malts answer the spice.',
  'sweet-spice': 'Cameroon’s sweet spice is bourbon’s natural partner.',
}

const CIGAR_ORDER: Record<CigarStrength, OrderSuggestion[]> = {
  mild: [
    { text: 'a gentle, fruity whisky — Speyside, Irish pot still, or Japanese', types: ['scotch', 'irish', 'japanese whisky'] },
    { text: 'Cognac VSOP — soft and floral won’t bulldoze a mild smoke', types: ['cognac', 'brandy'] },
    { text: 'a light aged rum, or a glass of Champagne', types: ['rum', 'sparkling wine'] },
  ],
  medium: [
    { text: 'a classic bourbon, or a sherry-cask Scotch', types: ['bourbon', 'scotch'] },
    { text: 'an aged rum — Jamaican or Barbadian', types: ['rum'] },
    { text: 'Cognac XO or a Tawny Port', types: ['cognac', 'fortified wine'] },
  ],
  full: [
    { text: 'a peated Islay or a sherry-bomb Scotch', types: ['scotch'] },
    { text: 'cask-strength bourbon or a bold rye', types: ['bourbon', 'rye'] },
    { text: 'an old rum, Armagnac, or a vintage Port', types: ['rum', 'armagnac', 'fortified wine'] },
  ],
}

const WRAPPER_ORDER: Record<WrapperFamily, OrderSuggestion> = {
  dark: { text: 'an aged rum or a Tawny Port — the wrapper’s cocoa and espresso love both', types: ['rum', 'fortified wine'] },
  light: { text: 'something creamy and cedar-y: Irish whiskey, a Speyside, or Cognac', types: ['irish', 'scotch', 'cognac'] },
  spicy: { text: 'a spicy rye, or a sherried Highland malt', types: ['rye', 'scotch'] },
  'sweet-spice': { text: 'bourbon — the wrapper’s sweet spice is its natural partner', types: ['bourbon'] },
}

function clampAxis(n: number): number {
  return Math.max(0, Math.min(5, n))
}

/** Human label for a resolved cigar: "Padrón 1964 Anniversary", "a full-bodied maduro". */
export function cigarLabel(c: ResolvedCigar): string {
  const named = [c.brand, c.line].filter(Boolean).join(' ')
  if (named) return named
  const strength = c.strength === 'full' ? 'full-bodied' : c.strength
  return c.wrapper ? `a ${strength} ${c.wrapper}` : `a ${strength} cigar`
}

/** Build the occasion for a resolved cigar. */
export function cigarOccasion(c: ResolvedCigar): Occasion {
  const family = wrapperFamily(c.wrapper)
  const target = { ...CIGAR_TARGET[c.strength] }
  if (family) {
    for (const axis of FLAVOR_AXES) {
      target[axis] = clampAxis(target[axis] + (WRAPPER_DELTA[family][axis] ?? 0))
    }
  }
  const affinity = { ...CIGAR_AFFINITY[c.strength] }
  if (family) {
    for (const t of WRAPPER_BUMP[family]) {
      affinity[t] = Math.min(1, (affinity[t] ?? 0) + 0.15)
    }
  }
  const strength = c.strength === 'full' ? 'full-bodied' : c.strength
  return {
    id: `cigar-${c.strength}${c.wrapper ? `-${c.wrapper}` : ''}`,
    label: cigarLabel(c),
    short: c.wrapper ? `a ${strength} ${c.wrapper}` : `a ${strength} cigar`,
    target,
    affinity,
    why: family ? `${CIGAR_WHY[c.strength]} ${WRAPPER_WHY[family]}` : CIGAR_WHY[c.strength],
    order: family
      ? [WRAPPER_ORDER[family], ...CIGAR_ORDER[c.strength].slice(0, 2)]
      : CIGAR_ORDER[c.strength],
  }
}

// ---- ranking the cabinet ----

/** Affinity for a type not named by the occasion: `other` and free-form
 *  types are unknowns, scored neutral; a known type the occasion left out is
 *  a deliberate zero. */
const NEUTRAL_AFFINITY = 0.3

export function affinityFor(occasion: Occasion, type: string): number {
  const t = canonicalType(type)
  const direct = occasion.affinity[t]
  if (direct !== undefined) return direct
  const group = typeGroupOf(t)
  if (group === undefined || group === 'other') return NEUTRAL_AFFINITY
  return occasion.affinity[group] ?? 0
}

/** Axes both the occasion and the bottle lean on, strongest in the bottle first. */
function sharedAxes(target: FlavorTags, profile: FlavorTags): string[] {
  return sharedFlavors(target, profile).sort(
    (a, b) => profile[b as keyof FlavorTags] - profile[a as keyof FlavorTags],
  )
}

export interface PairingPick {
  bottle: Bottle
  /** 0..1 */
  score: number
  reason: string
}

const DEFAULT_RATING = 6
const NO_PROFILE_SIMILARITY = 0.5

/**
 * Rank what's on the shelf (coffee, finished bottles, and bottles only tasted
 * elsewhere excluded) for an occasion. Score blends flavor similarity to the
 * target (45%), type affinity (40%), and the drinker's own rating (15%). With no target (an unknown dish) there is nothing to pair
 * against, so it is the drinker's rating alone — their best-rated bottles.
 */
export function rankPairings(
  occasion: Occasion,
  bottles: Bottle[],
  limit = 5,
): PairingPick[] {
  const targetVec = occasion.target ? flavorVector(occasion.target) : null
  return bottles
    // What can actually be poured: alcohol that is on the shelf. A finished
    // bottle or one tasted elsewhere still anchors the menu tips (orderTips).
    .filter((b) => familyOf(b.type) === 'alcohol' && onShelf(b))
    .map((b) => {
      const aff = affinityFor(occasion, b.type)
      const sim =
        targetVec && b.flavorProfile
          ? cosine(targetVec, flavorVector(b.flavorProfile))
          : NO_PROFILE_SIMILARITY
      const love = (b.avgRating ?? DEFAULT_RATING) / 10
      const score = targetVec ? 0.45 * sim + 0.4 * aff + 0.15 * love : love
      return {
        bottle: b,
        score: Math.round(Math.max(0, Math.min(1, score)) * 100) / 100,
        reason: reasonFor(occasion, b, aff),
      }
    })
    .sort((a, b) => b.score - a.score || a.bottle.name.localeCompare(b.bottle.name))
    .slice(0, limit)
}

function reasonFor(occasion: Occasion, b: Bottle, aff: number): string {
  const rated = b.avgRating != null ? `you rated it ${b.avgRating}` : null
  if (!occasion.target) return capitalize(rated ?? 'in your cabinet')

  const bits: string[] = []
  if (aff >= 0.8) bits.push(`a classic with ${occasion.short}`)
  else if (aff >= 0.5) bits.push(`at home with ${occasion.short}`)
  else if (aff === 0) bits.push(`an outside pick for ${occasion.short}`)

  const shared = b.flavorProfile ? sharedAxes(occasion.target, b.flavorProfile) : []
  if (shared.length > 0) bits.push(`brings the ${shared.slice(0, 2).join(' & ')} it wants`)
  if (rated && (b.avgRating ?? 0) >= 8) bits.push(rated)

  return capitalize(bits.slice(0, 2).join(' · ') || 'a reasonable match')
}

// ---- ordering off a menu ----

export interface OrderTip extends OrderSuggestion {
  /** The drinker's best-rated bottle of this kind (>= 7), to anchor the style. */
  favorite: Bottle | null
}

const FAVORITE_MIN_RATING = 7

/** The occasion's menu suggestions, each anchored to a loved bottle of the
 *  same kind when the cabinet has one ("you rated Caymus 8/10"). */
export function orderTips(occasion: Occasion, bottles: Bottle[]): OrderTip[] {
  return occasion.order.map((o) => {
    const kinds = new Set(o.types)
    const favorite =
      bottles
        .filter(
          (b) =>
            (b.avgRating ?? 0) >= FAVORITE_MIN_RATING &&
            (kinds.has(canonicalType(b.type)) ||
              kinds.has(typeGroupOf(b.type) ?? '')),
        )
        .sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0))[0] ?? null
    return { ...o, favorite }
  })
}
