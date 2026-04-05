/**
 * Trash/Validation Module Constants
 *
 * Patterns and known values for suspicious data detection.
 */

/**
 * Gibberish letter sequence detector.
 *
 * These letter combinations are extremely rare in legitimate English text
 * and GPU/software names. Their presence indicates randomly generated or
 * corrupted strings, which suggest fingerprint randomization.
 *
 * Pattern categories:
 * - Rare consonant clusters: qX, xZ, zX (almost never appear together)
 * - Invalid vowel-consonant pairs: bQ, fQ (unpronounceable)
 * - Triple consonant patterns that don't occur in English
 */
export const GIBBERISH_PATTERN =
  /[cC]f|[jJ][bcdfghlmprsty]|[qQ][bcdfghjklmnpsty]|[vV][bfhjkmpt]|[xX][dkrz]|[yY]y|[zZ][fr]|[cCxXzZ]j|[bBfFgGjJkKpPvVqQtTwWyYzZ]q|[cCfFgGjJpPqQwW]v|[jJqQvV]w|[bBcCdDfFgGhHjJkKmMpPqQsSvVwWxXzZ]x|[bBfFhHjJkKmMpPqQ]z/g;

/**
 * Letter case sequence patterns that indicate gibberish.
 *
 * Real product names follow consistent casing conventions:
 * - NVIDIA, GeForce (brand names)
 * - HD Graphics (title case)
 *
 * These patterns detect random casing:
 */
export const LETTER_CASE_TESTS = [
  /([A-Z]{3,}[a-z])/g, // ABCd - capitals followed by lowercase
  /([a-z][A-Z]{3,})/g, // aBCD - lowercase followed by capitals
  /([a-z][A-Z]{2,}[a-z])/g, // aBC...z - sandwiched capitals
  /([a-z][\d]{2,}[a-z])/g, // a##...b - digits sandwiched in lowercase
  /([A-Z][\d]{2,}[a-z])/g, // A##...b - upper, digits, lower
  /([a-z][\d]{2,}[A-Z])/g, // a##...B - lower, digits, upper
];

/**
 * Known gibberish sequences to allow.
 *
 * Some legitimate GPU names contain sequences that match gibberish patterns.
 * These are whitelisted to prevent false positives.
 */
export const ALLOWED_GIBBERS = [
  'bz', // Rare but appears in some codenames
  'cf', // CrossFire (AMD)
  'fx', // GeForce FX series
  'mx', // GeForce MX series
  'vb', // VirtualBox
  'xd', // Common emoticon
  'gx', // Gaming X (MSI)
  'PCIe', // PCI Express
  'vm', // Virtual Machine
  'NVIDIAGa', // NVIDIA GameReady
];

/**
 * Known GPU manufacturer and product name parts.
 *
 * A legitimate WebGL renderer string should contain at least some of these.
 * Absence of all known parts suggests a fake or randomized string.
 */
export const KNOWN_GPU_PARTS = [
  'AMD',
  'ANGLE',
  'ASUS',
  'ATI',
  'ATI Radeon',
  'ATI Technologies Inc',
  'Adreno',
  'Android Emulator',
  'Apple',
  'Apple GPU',
  'Apple M1',
  'Chipset',
  'D3D11',
  'Direct3D',
  'Express Chipset',
  'GeForce',
  'Generation',
  'Generic Renderer',
  'Google',
  'Google SwiftShader',
  'Graphics',
  'Graphics Media Accelerator',
  'HD Graphics Family',
  'Intel',
  'Intel(R) HD Graphics',
  'Intel(R) UHD Graphics',
  'Iris',
  'KBL Graphics',
  'Mali',
  'Mesa',
  'Mesa DRI',
  'Metal',
  'Microsoft',
  'Microsoft Basic Render Driver',
  'Microsoft Corporation',
  'NVIDIA',
  'NVIDIA Corporation',
  'NVIDIAGameReadyD3D',
  'OpenGL',
  'OpenGL Engine',
  'Open Source Technology Center',
  'Parallels',
  'Parallels Display Adapter',
  'PCIe',
  'Plus Graphics',
  'PowerVR',
  'Pro Graphics',
  'Quadro',
  'Radeon',
  'Radeon Pro',
  'Radeon Pro Vega',
  'Samsung',
  'SSE2',
  'VMware',
  'VMware SVGA 3D',
  'Vega',
  'VirtualBox',
  'VirtualBox Graphics Adapter',
  'Vulkan',
  'Xe Graphics',
  'llvmpipe',
];

/**
 * Regex for compressing WebGL renderer strings.
 *
 * Removes verbose implementation details to create a normalized form
 * that's more stable across driver versions.
 */
export const RENDERER_COMPRESSION_PATTERNS = [
  // Remove ANGLE wrapper details
  /ANGLE \(|\sDirect3D.+|\sD3D.+|\svs_.+\)/gi,
  // Remove driver-specific info
  /\((DRM|POLARIS|LLVM).+|Mesa.+|(ATI|INTEL)-.+|Metal\s-\s.+|NVIDIA\s[\d|\.]+/gi,
  // Remove common suffixes
  /(\s(ti|\d{1,2}GB|super)$)/gi,
  // Collapse whitespace
  /\s{2,}/g,
];

/**
 * Pattern to normalize GPU model numbers for fuzzy matching.
 *
 * Converts specific model numbers to generic forms:
 * - RTX 3080 -> RTX 3000s
 * - Radeon HD 7970 -> Radeon HD 7000s
 */
export const MODEL_NORMALIZATION_PATTERN =
  /((r|g)(t|)(x|s|\d) |Graphics |GeForce |Radeon (HD |Pro |))(\d+)/i;
