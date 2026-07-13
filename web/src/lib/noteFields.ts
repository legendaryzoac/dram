/**
 * Display labels + placeholders for a tasting note's three prose fields, per
 * beverage family. The wire fields are always nose / palate / finish; coffee
 * just wears them as aroma / flavor / aftertaste. Shared by the note form and
 * the notes list on the detail page — kept out of the component files so
 * fast refresh stays component-only.
 */
export const NOTE_FIELD_LABELS = {
  alcohol: {
    nose: 'Nose',
    palate: 'Palate',
    finish: 'Finish',
    nosePh: 'What do you smell? Citrus, smoke, honey…',
    palatePh: 'How does it taste? Body, sweetness, spice…',
    finishPh: 'How does it end? Length, warmth, aftertaste…',
  },
  coffee: {
    nose: 'Aroma',
    palate: 'Flavor',
    finish: 'Aftertaste',
    nosePh: 'What do you smell? Florals, berries, cocoa…',
    palatePh: 'How does it taste? Sweetness, acidity, body…',
    finishPh: 'How does it linger? Clean, syrupy, drying…',
  },
} as const
