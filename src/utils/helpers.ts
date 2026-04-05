/**
 * Helpers Module
 *
 * Re-exports and remaining utilities. Most functionality has been
 * moved to focused modules - import directly from those instead.
 *
 * @module utils/helpers
 * @see ./platform - OS detection
 * @see ./engine - JS engine detection
 * @see ./brave - Brave browser detection
 * @see ./timing - Performance timing
 */

import { PlatformClassifier } from './types';
import { getOS as getOSFromPlatform } from './platform';

// Re-export from focused modules with deprecation notices
export { IS_BLINK, IS_GECKO, IS_WEBKIT, JS_ENGINE } from './engine';

export {
  LIKE_BRAVE,
  braveBrowser,
  getBraveMode,
  getBraveUnprotectedParameters,
} from './brave';

export {
  createTimer,
  queueEvent,
  logTestResult,
  performanceLogger,
  getPromiseRaceFulfilled,
} from './timing';

// @ts-expect-error
export const IS_WORKER_SCOPE = !self.document && self.WorkerGlobalScope;

/**
 * @deprecated Import directly from './platform' instead. Will be removed in v2.0.
 * @example
 * // Before (deprecated):
 * import { getOS } from './helpers';
 *
 * // After (recommended):
 * import { getOS } from './platform';
 */
const getOS = getOSFromPlatform;
export { getOS };

// Import IS_BLINK for use in this file
import { IS_BLINK } from './engine';

/**
 * Classify platform from user agent and platform strings.
 */
function getReportedPlatform(
  userAgent: string,
  platform?: string,
): PlatformClassifier[] {
  // user agent os lie
  const userAgentOS =
    // order is important
    /win(dows|16|32|64|95|98|nt)|wow64/gi.test(userAgent)
      ? PlatformClassifier.WINDOWS
      : /android|linux|cros/gi.test(userAgent)
        ? PlatformClassifier.LINUX
        : /(i(os|p(ad|hone|od)))|mac/gi.test(userAgent)
          ? PlatformClassifier.APPLE
          : PlatformClassifier.OTHER;

  if (!platform) return [userAgentOS];

  const platformOS =
    // order is important
    /win/gi.test(platform)
      ? PlatformClassifier.WINDOWS
      : /android|arm|linux/gi.test(platform)
        ? PlatformClassifier.LINUX
        : /(i(os|p(ad|hone|od)))|mac/gi.test(platform)
          ? PlatformClassifier.APPLE
          : PlatformClassifier.OTHER;
  return [userAgentOS, platformOS];
}
const { userAgent: navUserAgent, platform: navPlatform } = self.navigator || {};
const [USER_AGENT_OS, PLATFORM_OS] = getReportedPlatform(
  navUserAgent,
  navPlatform,
);

/**
 * Decrypts and identifies the browser name and version from a user agent string.
 *
 * Parses the user agent to detect specific browsers (Chrome, Firefox, Safari, Edge,
 * Opera, Vivaldi, DuckDuckGo, Yandex, Brave, PaleMoon) and returns a formatted
 * string with the browser engine and version, plus any overlay browser identifier.
 *
 * @param ua - The raw user agent string to parse
 * @param os - The operating system string used for Apple device detection
 * @param isBrave - Whether the browser has been identified as Brave
 * @returns A formatted string of "browser version [overlay]" or "unknown"
 */
const decryptUserAgent = ({
  ua,
  os,
  isBrave,
}: {
  ua: string;
  os: string;
  isBrave: boolean;
}): string => {
  const apple = /ipad|iphone|ipod|ios|mac/gi.test(os);
  const isOpera = /OPR\//g.test(ua);
  const isVivaldi = /Vivaldi/g.test(ua);
  const isDuckDuckGo = /DuckDuckGo/g.test(ua);
  const isYandex = /YaBrowser/g.test(ua);
  const paleMoon = ua.match(/(palemoon)\/(\d+)./i);
  const edge = ua.match(/(edgios|edg|edge|edga)\/(\d+)./i);
  const edgios = edge && /edgios/i.test(edge[1]);
  const chromium = ua.match(/(crios|chrome)\/(\d+)./i);
  const firefox = ua.match(/(fxios|firefox)\/(\d+)./i);
  const likeSafari = /AppleWebKit/g.test(ua) && /Safari/g.test(ua);
  const safari =
    likeSafari &&
    !firefox &&
    !chromium &&
    !edge &&
    ua.match(/(version)\/(\d+)\.(\d|\.)+\s(mobile|safari)/i);

  if (chromium) {
    const browser = chromium[1];
    const version = chromium[2];
    const like = isOpera
      ? ' Opera'
      : isVivaldi
        ? ' Vivaldi'
        : isDuckDuckGo
          ? ' DuckDuckGo'
          : isYandex
            ? ' Yandex'
            : edge
              ? ' Edge'
              : isBrave
                ? ' Brave'
                : '';
    return `${browser} ${version}${like}`;
  } else if (edgios) {
    const browser = edge![1];
    const version = edge![2];
    return `${browser} ${version}`;
  } else if (firefox) {
    const browser = paleMoon ? paleMoon[1] : firefox[1];
    const version = paleMoon ? paleMoon[2] : firefox[2];
    return `${browser} ${version}`;
  } else if (apple && safari) {
    const browser = 'Safari';
    const version = safari[2];
    return `${browser} ${version}`;
  }
  return 'unknown';
};

/**
 * Extracts the OS and device platform information from a user agent string.
 *
 * Parses the parenthesized platform section of the user agent to identify and
 * return a cleaned platform descriptor for Android, Windows, ChromeOS, Linux,
 * or Apple devices. Maps Windows NT versions to release names and macOS versions
 * to codenames where possible.
 *
 * @param userAgent - The full user agent string to extract platform info from
 * @param excludeBuild - Whether to strip build identifiers from the result (defaults to true)
 * @returns A cleaned platform string or "unknown" if parsing fails
 */
const getUserAgentPlatform = ({
  userAgent,
  excludeBuild = true,
}: {
  userAgent: string;
  excludeBuild?: boolean;
}): string => {
  if (!userAgent) {
    return 'unknown';
  }

  // patterns
  const nonPlatformParenthesis =
    /\((khtml|unlike|vizio|like gec|internal dummy|org\.eclipse|openssl|ipv6|via translate|safari|cardamon).+|xt\d+\)/gi;
  const parenthesis = /\((.+)\)/;
  const android = /((android).+)/i;
  const androidNoise =
    /^(linux|[a-z]|wv|mobile|[a-z]{2}(-|_)[a-z]{2}|[a-z]{2})$|windows|(rv:|trident|webview|iemobile).+/i;
  const androidBuild = /build\/.+\s|\sbuild\/.+/i;
  const androidRelease = /android( |-)\d+/i;
  const windows = /((windows).+)/i;
  const windowsNoise =
    /^(windows|ms(-|)office|microsoft|compatible|[a-z]|x64|[a-z]{2}(-|_)[a-z]{2}|[a-z]{2})$|(rv:|outlook|ms(-|)office|microsoft|trident|\.net|msie|httrack|media center|infopath|aol|opera|iemobile|webbrowser).+/i;
  const windows64bitCPU = /w(ow|in)64/i;
  const cros = /cros/i;
  const crosNoise =
    /^([a-z]|x11|[a-z]{2}(-|_)[a-z]{2}|[a-z]{2})$|(rv:|trident).+/i;
  const crosBuild = /\d+\.\d+\.\d+/i;
  const linux = /linux|x11|ubuntu|debian/i;
  const linuxNoise =
    /^([a-z]|x11|unknown|compatible|[a-z]{2}(-|_)[a-z]{2}|[a-z]{2})$|(rv:|java|oracle|\+http|http|unknown|mozilla|konqueror|valve).+/i;
  const apple =
    /(cpu iphone|cpu os|iphone os|mac os|macos|intel os|ppc mac).+/i;
  const appleNoise =
    /^([a-z]|macintosh|compatible|mimic|[a-z]{2}(-|_)[a-z]{2}|[a-z]{2}|rv|\d+\.\d+)$|(rv:|silk|valve).+/i;
  const appleRelease =
    /(ppc |intel |)(mac|mac |)os (x |x|)(\d{2}(_|\.)\d{1,2}|\d{2,})/i;
  const otherOS =
    /((symbianos|nokia|blackberry|morphos|mac).+)|\/linux|freebsd|symbos|series \d+|win\d+|unix|hp-ux|bsdi|bsd|x86_64/i;

  /** Counts how many identifiers in the list match the given device pattern. */
  const isDevice = (list: string[], device: RegExp) =>
    list.filter((x) => device.test(x)).length;

  userAgent = userAgent
    .trim()
    .replace(/\s{2,}/, ' ')
    .replace(nonPlatformParenthesis, '');

  if (parenthesis.test(userAgent)) {
    const platformSection = userAgent.match(parenthesis)![0];
    const identifiers = platformSection
      .slice(1, -1)
      .replace(/,/g, ';')
      .split(';')
      .map((x) => x.trim());

    if (isDevice(identifiers, android)) {
      return identifiers
        .map((x) =>
          androidRelease.test(x)
            ? androidRelease.exec(x)![0].replace('-', ' ')
            : x,
        )
        .filter((x) => !androidNoise.test(x))
        .join(' ')
        .replace(excludeBuild ? androidBuild : '', '')
        .trim()
        .replace(/\s{2,}/, ' ');
    } else if (isDevice(identifiers, windows)) {
      return identifiers
        .filter((x) => !windowsNoise.test(x))
        .join(' ')
        .replace(/\sNT (\d+\.\d+)/, (match, version) => {
          return version == '10.0'
            ? ' 10'
            : version == '6.3'
              ? ' 8.1'
              : version == '6.2'
                ? ' 8'
                : version == '6.1'
                  ? ' 7'
                  : version == '6.0'
                    ? ' Vista'
                    : version == '5.2'
                      ? ' XP Pro'
                      : version == '5.1'
                        ? ' XP'
                        : version == '5.0'
                          ? ' 2000'
                          : version == '4.0'
                            ? match
                            : ' ' + version;
        })
        .replace(windows64bitCPU, '(64-bit)')
        .trim()
        .replace(/\s{2,}/, ' ');
    } else if (isDevice(identifiers, cros)) {
      return identifiers
        .filter((x) => !crosNoise.test(x))
        .join(' ')
        .replace(excludeBuild ? crosBuild : '', '')
        .trim()
        .replace(/\s{2,}/, ' ');
    } else if (isDevice(identifiers, linux)) {
      return identifiers
        .filter((x) => !linuxNoise.test(x))
        .join(' ')
        .trim()
        .replace(/\s{2,}/, ' ');
    } else if (isDevice(identifiers, apple)) {
      return identifiers
        .map((x) => {
          if (appleRelease.test(x)) {
            const release = appleRelease.exec(x)![0];
            const versionMap: Record<string, string> = {
              '10_7': 'Lion',
              '10_8': 'Mountain Lion',
              '10_9': 'Mavericks',
              '10_10': 'Yosemite',
              '10_11': 'El Capitan',
              '10_12': 'Sierra',
              '10_13': 'High Sierra',
              '10_14': 'Mojave',
              '10_15': 'Catalina',
              '11': 'Big Sur',
              '12': 'Monterey',
              '13': 'Ventura',
            };
            const version = (
              (/(\d{2}(_|\.)\d{1,2}|\d{2,})/.exec(release) || [])[0] || ''
            ).replace(/\./g, '_');
            const isOSX = /^10/.test(version);
            const id = isOSX ? version : (/^\d{2,}/.exec(version) || [])[0];
            const codeName = id ? versionMap[id] : undefined;
            return codeName ? `macOS ${codeName}` : release;
          }
          return x;
        })
        .filter((x) => !appleNoise.test(x))
        .join(' ')
        .replace(/\slike mac.+/gi, '')
        .trim()
        .replace(/\s{2,}/, ' ');
    } else {
      const other = identifiers.filter((x) => otherOS.test(x));
      if (other.length) {
        return other
          .join(' ')
          .trim()
          .replace(/\s{2,}/, ' ');
      }
      return identifiers.join(' ');
    }
  } else {
    return 'unknown';
  }
};

/**
 * Determines the Windows release version from platform version data.
 *
 * Uses the Chromium platform version string and font-based platform detection to
 * map internal version numbers to user-facing Windows release names (e.g., 7, 8,
 * 10, 11). Only applies in Blink-based browsers that support accent-color.
 *
 * @param platform - The platform name string (must be "Windows" to produce a result)
 * @param platformVersion - The platform version string (e.g., "10.0.0")
 * @param fontPlatformVersion - The font-detected platform version for older OS fallback
 * @returns A formatted "Windows [version] [platformVersion]" string, or undefined if not applicable
 */
const computeWindowsRelease = ({
  platform,
  platformVersion,
  fontPlatformVersion = '',
}: {
  platform: string;
  platformVersion: string;
  fontPlatformVersion?: string;
}): string | undefined => {
  if (
    platform != 'Windows' ||
    !(IS_BLINK && CSS.supports('accent-color', 'initial'))
  ) {
    return;
  }
  const platformVersionNumber = +(/(\d+)\./.exec(platformVersion) || [])[1];

  // https://github.com/WICG/ua-client-hints/issues/220#issuecomment-870858413
  // https://docs.microsoft.com/en-us/microsoft-edge/web-platform/how-to-detect-win11
  // https://docs.microsoft.com/en-us/microsoft-edge/web-platform/user-agent-guidance
  const release: Record<string, string> = {
    '0.1.0': '7',
    '0.2.0': '8',
    '0.3.0': '8.1',
    '1.0.0': '10 (1507)',
    '2.0.0': '10 (1511)',
    '3.0.0': '10 (1607)',
    '4.0.0': '10 (1703)',
    '5.0.0': '10 (1709)',
    '6.0.0': '10 (1803)',
    '7.0.0': '10 (1809)',
    '8.0.0': '10 (1903|1909)',
    '10.0.0': '10 (2004|20H2|21H1)',
    '11.0.0': '10',
    '12.0.0': '10',
  };

  const oldFontPlatformVersionNumber = (/7|8\.1|8/.exec(fontPlatformVersion) ||
    [])[0];
  const version =
    platformVersionNumber >= 13
      ? '11'
      : platformVersionNumber == 0 && oldFontPlatformVersionNumber
        ? oldFontPlatformVersionNumber
        : release[platformVersion] || 'Unknown';
  return `Windows ${version} [${platformVersion}]`;
};

/**
 * Checks whether the given user agent string matches the post-Chrome UA reduction format.
 *
 * Detects if the user agent conforms to the unified/reduced user agent template
 * introduced by Chrome's User-Agent Reduction initiative, where platform details
 * are replaced with fixed values.
 *
 * @param userAgent - The user agent string to test
 * @returns True if the user agent matches the reduced UA pattern in a Blink browser
 */
const isUAPostReduction = (userAgent: string): boolean => {
  const matcher =
    /Mozilla\/5\.0 \((Macintosh; Intel Mac OS X 10_15_7|Windows NT 10\.0; Win64; x64|(X11; (CrOS|Linux) x86_64)|(Linux; Android 10(; K|)))\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0( Mobile|) Safari\/537\.36/;
  const unifiedPlatform = (matcher.exec(userAgent) || [])[1];
  return IS_BLINK && !!unifiedPlatform;
};

/**
 * Emoji codepoints for fingerprinting.
 * Different platforms render these differently.
 */
const EMOJIS = [
  [128512],
  [9786],
  [129333, 8205, 9794, 65039],
  [9832],
  [9784],
  [9895],
  [8265],
  [8505],
  [127987, 65039, 8205, 9895, 65039],
  [129394],
  [9785],
  [9760],
  [129489, 8205, 129456],
  [129487, 8205, 9794, 65039],
  [9975],
  [129489, 8205, 129309, 8205, 129489],
  [9752],
  [9968],
  [9961],
  [9972],
  [9992],
  [9201],
  [9928],
  [9730],
  [9969],
  [9731],
  [9732],
  [9976],
  [9823],
  [9937],
  [9000],
  [9993],
  [9999],

  [128105, 8205, 10084, 65039, 8205, 128139, 8205, 128104],
  [128104, 8205, 128105, 8205, 128103, 8205, 128102],
  [128104, 8205, 128105, 8205, 128102],

  // android 11
  [128512],
  [169],
  [174],
  [8482],
  [128065, 65039, 8205, 128488, 65039],

  // other
  [10002],
  [9986],
  [9935],
  [9874],
  [9876],
  [9881],
  [9939],
  [9879],
  [9904],
  [9905],
  [9888],
  [9762],
  [9763],
  [11014],
  [8599],
  [10145],
  [11013],
  [9883],
  [10017],
  [10013],
  [9766],
  [9654],
  [9197],
  [9199],
  [9167],
  [9792],
  [9794],
  [10006],
  [12336],
  [9877],
  [9884],
  [10004],
  [10035],
  [10055],
  [9724],
  [9642],
  [10083],
  [10084],
  [9996],
  [9757],
  [9997],
  [10052],
  [9878],
  [8618],
  [9775],
  [9770],
  [9774],
  [9745],
  [10036],
  [127344],
  [127359],
].map((emojiCode) => String.fromCodePoint(...emojiCode));

/**
 * CSS font stack for font fingerprinting.
 * Includes platform-specific fonts for Windows, macOS, and Linux.
 */
const CSS_FONT_FAMILY = `
	'Segoe Fluent Icons',
	'Ink Free',
	'Bahnschrift',
	'Segoe MDL2 Assets',
	'HoloLens MDL2 Assets',
	'Leelawadee UI',
	'Javanese Text',
	'Segoe UI Emoji',
	'Aldhabi',
	'Gadugi',
	'Myanmar Text',
	'Nirmala UI',
	'Lucida Console',
	'Cambria Math',
	'Bai Jamjuree',
	'Chakra Petch',
	'Charmonman',
	'Fahkwang',
	'K2D',
	'Kodchasan',
	'KoHo',
	'Sarabun',
	'Srisakdi',
	'Galvji',
	'MuktaMahee Regular',
	'InaiMathi Bold',
	'American Typewriter Semibold',
	'Futura Bold',
	'SignPainter-HouseScript Semibold',
	'PingFang HK Light',
	'Kohinoor Devanagari Medium',
	'Luminari',
	'Geneva',
	'Helvetica Neue',
	'Droid Sans Mono',
	'Dancing Script',
	'Roboto',
	'Ubuntu',
	'Liberation Mono',
	'Source Code Pro',
	'DejaVu Sans',
	'OpenSymbol',
	'Chilanka',
	'Cousine',
	'Arimo',
	'Jomolhari',
	'MONO',
	'Noto Color Emoji',
	sans-serif !important
`;

/**
 * Extract GPU brand from renderer string.
 */
function getGpuBrand(gpu: string): string | null {
  if (!gpu) return null;
  const gpuBrandMatcher =
    /(adreno|amd|apple|intel|llvm|mali|microsoft|nvidia|parallels|powervr|samsung|swiftshader|virtualbox|vmware)/i;

  const brand = /radeon/i.test(gpu)
    ? 'AMD'
    : /geforce/i.test(gpu)
      ? 'NVIDIA'
      : (gpuBrandMatcher.exec(gpu)?.[0] || 'other').toLocaleUpperCase();

  return brand;
}

/** Collect fingerprints for analysis */
const Analysis: Record<string, unknown> = {};

/** Lower entropy mode flags */
const LowerEntropy: Record<string, boolean> = {
  AUDIO: false,
  CANVAS: false,
  FONTS: false,
  SCREEN: false,
  TIME_ZONE: false,
  WEBGL: false,
};

export {
  getReportedPlatform,
  USER_AGENT_OS,
  PLATFORM_OS,
  decryptUserAgent,
  getUserAgentPlatform,
  computeWindowsRelease,
  isUAPostReduction,
  EMOJIS,
  CSS_FONT_FAMILY,
  Analysis,
  LowerEntropy,
  getGpuBrand,
};
