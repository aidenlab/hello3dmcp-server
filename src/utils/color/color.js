// Color utility functions
// Note: Removed three.js dependency - server only needs hex strings, not THREE.Color objects

/**
 * Apple Crayon color palette - hex strings only
 * A collection of 48 hex color strings used in Apple's classic Mac OS
 */
const appleCrayonColorsHexStrings = new Map()
    .set('licorice', '#000000')
    .set('lead', '#1E1E1E')
    .set('tungsten', '#3A3A3A')
    .set('iron', '#545453')
    .set('steel', '#6E6E6E')
    .set('tin', '#878687')
    .set('nickel', '#888787')
    .set('aluminum', '#A09FA0')
    .set('magnesium', '#B8B8B8')
    .set('silver', '#D0D0D0')
    .set('mercury', '#E8E8E8')
    .set('snow', '#FFFFFF')
    .set('cayenne', '#891100')
    .set('mocha', '#894800')
    .set('asparagus', '#888501')
    .set('fern', '#458401')
    .set('clover', '#028401')
    .set('moss', '#018448')
    .set('teal', '#008688')
    .set('ocean', '#004A88')
    .set('midnight', '#001888')
    .set('eggplant', '#491A88')
    .set('plum', '#891E88')
    .set('maroon', '#891648')
    .set('maraschino', '#FF2101')
    .set('tangerine', '#FF8802')
    .set('lemon', '#FFFA03')
    .set('lime', '#83F902')
    .set('spring', '#05F802')
    .set('sea foam', '#03F987')
    .set('turquoise', '#00FDFF')
    .set('aqua', '#008CFF')
    .set('blueberry', '#002EFF')
    .set('grape', '#8931FF')
    .set('magenta', '#FF39FF')
    .set('strawberry', '#FF2987')
    .set('salmon', '#FF726E')
    .set('cantaloupe', '#FFCE6E')
    .set('banana', '#FFFB6D')
    .set('honeydew', '#CEFA6E')
    .set('flora', '#68F96E')
    .set('spindrift', '#68FBD0')
    .set('ice', '#68FDFF')
    .set('sky', '#6ACFFF')
    .set('orchid', '#6E76FF')
    .set('lavender', '#D278FF')
    .set('bubblegum', '#FF7AFF')
    .set('carnation', '#FF7FD3');

// Predefined color categories
const colorCategories = {
    vibrant: [
        'maraschino',
        'tangerine',
        'lemon',
        'lime',
        'spring',
        'sea foam',
        'turquoise',
        'aqua',
        'blueberry',
        'grape',
        'magenta',
        'strawberry',
        'carnation'
    ],
    grays: [
        'licorice',
        'lead',
        'tungsten',
        'iron',
        'steel',
        'tin',
        'nickel',
        'aluminum',
        'magnesium',
        'silver',
        'mercury',
        'snow'
    ],
    pastels: [
        'snow',
        'salmon',
        'cantaloupe',
        'banana',
        'honeydew',
        'flora',
        'spindrift',
        'ice',
        'sky',
        'orchid',
        'lavender',
        'bubblegum',
        'carnation'
    ],
    earth: [
        'cayenne',
        'mocha',
        'asparagus',
        'fern',
        'clover',
        'moss',
        'teal',
        'ocean',
        'midnight',
        'eggplant',
        'plum',
        'maroon'
    ]
};

// Color complements mapping
const colorComplements = new Map([
    // Vibrant colors
    ['maraschino', 'turquoise'],
    ['tangerine', 'blueberry'],
    ['lemon', 'grape'],
    ['lime', 'magenta'],
    ['spring', 'strawberry'],
    ['sea foam', 'carnation'],
    ['turquoise', 'maraschino'],
    ['aqua', 'strawberry'],
    ['blueberry', 'tangerine'],
    ['grape', 'lemon'],
    ['magenta', 'lime'],
    ['strawberry', 'spring'],
    ['carnation', 'sea foam'],

    // Pastels
    ['salmon', 'sky'],
    ['cantaloupe', 'orchid'],
    ['banana', 'lavender'],
    ['honeydew', 'bubblegum'],
    ['flora', 'ice'],
    ['spindrift', 'carnation'],
    ['ice', 'flora'],
    ['sky', 'salmon'],
    ['orchid', 'cantaloupe'],
    ['lavender', 'banana'],
    ['bubblegum', 'honeydew'],

    // Earth tones
    ['cayenne', 'teal'],
    ['mocha', 'ocean'],
    ['asparagus', 'midnight'],
    ['fern', 'eggplant'],
    ['clover', 'plum'],
    ['moss', 'maroon'],
    ['teal', 'cayenne'],
    ['ocean', 'mocha'],
    ['midnight', 'asparagus'],
    ['eggplant', 'fern'],
    ['plum', 'clover'],
    ['maroon', 'moss'],

    // Grays - complement with vibrant colors
    ['licorice', 'lemon'],
    ['lead', 'tangerine'],
    ['tungsten', 'maraschino'],
    ['iron', 'spring'],
    ['steel', 'sea foam'],
    ['tin', 'turquoise'],
    ['nickel', 'aqua'],
    ['aluminum', 'blueberry'],
    ['magnesium', 'grape'],
    ['silver', 'magenta'],
    ['mercury', 'strawberry'],
    ['snow', 'carnation']
]);

// Note: Functions that returned THREE.Color objects have been removed
// The server only needs hex strings via appleCrayonColorsHexStrings

export {
    appleCrayonColorsHexStrings,
    colorComplements
};

