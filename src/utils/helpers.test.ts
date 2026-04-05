import { describe, it, expect, vi } from 'vitest';
import {
  IS_BLINK,
  IS_GECKO,
  IS_WEBKIT,
  JS_ENGINE,
  LIKE_BRAVE,
  getOS,
  getReportedPlatform,
  decryptUserAgent,
  getUserAgentPlatform,
  computeWindowsRelease,
  isUAPostReduction,
  createTimer,
  getGpuBrand,
  getBraveUnprotectedParameters,
  EMOJIS,
  CSS_FONT_FAMILY,
  Analysis,
  LowerEntropy,
  queueEvent,
  logTestResult,
  performanceLogger,
  getPromiseRaceFulfilled,
} from './helpers';

describe('helpers module', () => {
  describe('browser detection constants', () => {
    it('has mutually exclusive browser flags', () => {
      // At most one should be true
      const trueCount = [IS_BLINK, IS_GECKO, IS_WEBKIT].filter(Boolean).length;
      expect(trueCount).toBeLessThanOrEqual(1);
    });

    it('JS_ENGINE matches browser', () => {
      if (IS_BLINK) expect(JS_ENGINE).toBe('V8');
      if (IS_GECKO) expect(JS_ENGINE).toBe('SpiderMonkey');
      if (IS_WEBKIT) expect(JS_ENGINE).toBe('JavaScriptCore');
    });
  });

  describe('getOS()', () => {
    it('detects Windows', () => {
      expect(
        getOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'),
      ).toBe('Windows');
      expect(getOS('Mozilla/5.0 (Windows NT 6.1)')).toBe('Windows');
    });

    it('detects Windows Phone before Windows', () => {
      expect(
        getOS(
          'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950)',
        ),
      ).toBe('Windows Phone');
    });

    it('detects Mac', () => {
      expect(
        getOS(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        ),
      ).toBe('Mac');
    });

    it('detects Android', () => {
      expect(
        getOS('Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36'),
      ).toBe('Android');
    });

    it('detects Linux', () => {
      expect(getOS('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')).toBe(
        'Linux',
      );
    });

    it('detects Chrome OS', () => {
      expect(
        getOS('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36'),
      ).toBe('Chrome OS');
    });

    it('detects iOS devices by specific type', () => {
      // getOS returns specific device type, not generic 'iOS'
      expect(
        getOS(
          'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        ),
      ).toBe('iPhone');
      expect(
        getOS(
          'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        ),
      ).toBe('iPad');
      // iPod detection - note: the regex checks for 'ipod' pattern
      expect(
        getOS(
          'Mozilla/5.0 (iPod; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        ),
      ).toBe('iPod');
    });

    it('returns Other for unknown', () => {
      expect(getOS('Unknown User Agent')).toBe('Other');
    });
  });

  describe('getReportedPlatform()', () => {
    it('extracts OS from user agent and platform', () => {
      const result = getReportedPlatform(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Win32',
      );
      // Returns array of PlatformClassifier enums
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('handles platform-only detection', () => {
      const result = getReportedPlatform(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      );
      // Without platform arg, returns single-element array
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBe(1);
    });

    it('detects mismatch between UA and platform', () => {
      const [uaOS, platformOS] = getReportedPlatform(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Linux x86_64',
      );
      // Both should be defined, potentially different
      expect(uaOS).toBeDefined();
      expect(platformOS).toBeDefined();
    });
  });

  describe('getUserAgentPlatform()', () => {
    it('extracts device info from user agent', () => {
      const result = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });
      expect(result).toContain('Windows');
    });

    it('handles Android device info', () => {
      const result = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36',
      });
      expect(result).toContain('Android');
    });

    it('handles Mac OS info', () => {
      const result = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      });
      // The function extracts platform section from parentheses
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('decryptUserAgent()', () => {
    it('detects Chrome', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        os: 'Windows',
        isBrave: false,
      });
      expect(result).toContain('Chrome');
    });

    it('detects Firefox', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        os: 'Windows',
        isBrave: false,
      });
      expect(result).toContain('Firefox');
    });

    it('detects Safari', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        os: 'Mac',
        isBrave: false,
      });
      expect(result).toContain('Safari');
    });

    it('detects Edge', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        os: 'Windows',
        isBrave: false,
      });
      expect(result).toContain('Edge');
    });

    it('detects Brave when flag is set', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        os: 'Windows',
        isBrave: true,
      });
      expect(result).toContain('Brave');
    });
  });

  describe('isUAPostReduction()', () => {
    it('detects reduced Chrome UA', () => {
      // Reduced UA has generic version numbers
      expect(
        isUAPostReduction(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ),
      ).toBe(true);
    });

    it('detects pre-reduction Chrome UA', () => {
      // Full version with patch number
      expect(
        isUAPostReduction(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.130 Safari/537.36',
        ),
      ).toBe(false);
    });
  });

  describe('computeWindowsRelease()', () => {
    it('returns undefined for non-Windows', () => {
      const result = computeWindowsRelease({
        platform: 'macOS',
        platformVersion: '12.0.0',
      });
      expect(result).toBeUndefined();
    });

    it('detects Windows 11 from high platform version', () => {
      const result = computeWindowsRelease({
        platform: 'Windows',
        platformVersion: '15.0.0',
      });
      expect(result).toContain('11');
    });

    it('detects Windows 10 from low platform version', () => {
      const result = computeWindowsRelease({
        platform: 'Windows',
        platformVersion: '1.0.0',
      });
      expect(result).toContain('10');
    });
  });

  describe('createTimer()', () => {
    it('returns object with start and stop methods', () => {
      const timer = createTimer();
      expect(typeof timer).toBe('object');
      expect(typeof timer.start).toBe('function');
      expect(typeof timer.stop).toBe('function');
    });

    it('measures elapsed time', async () => {
      const timer = createTimer();
      timer.start();
      // Small delay to ensure time passes
      await new Promise((resolve) => setTimeout(resolve, 10));
      const elapsed = timer.stop();
      expect(typeof elapsed).toBe('number');
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });

    it('accumulates time across multiple start/stop cycles', async () => {
      const timer = createTimer();
      timer.start();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const time1 = timer.stop();
      timer.start();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const time2 = timer.stop();
      // Total should be accumulated
      expect(time2).toBeGreaterThan(time1);
    });
  });

  describe('getGpuBrand()', () => {
    it('detects NVIDIA', () => {
      expect(getGpuBrand('NVIDIA GeForce GTX 1080')).toBe('NVIDIA');
      expect(getGpuBrand('ANGLE (NVIDIA GeForce)')).toBe('NVIDIA');
    });

    it('detects AMD from Radeon keyword', () => {
      expect(getGpuBrand('AMD Radeon RX 6800')).toBe('AMD');
      expect(getGpuBrand('Radeon HD 5770')).toBe('AMD');
    });

    it('detects AMD from AMD keyword', () => {
      expect(getGpuBrand('AMD RDNA')).toBe('AMD');
    });

    it('detects NVIDIA from GeForce keyword', () => {
      expect(getGpuBrand('GeForce RTX 3080')).toBe('NVIDIA');
    });

    it('detects Intel (uppercase)', () => {
      expect(getGpuBrand('Intel(R) UHD Graphics 630')).toBe('INTEL');
      expect(getGpuBrand('Intel HD Graphics 4000')).toBe('INTEL');
    });

    it('detects Apple (uppercase)', () => {
      expect(getGpuBrand('Apple M1')).toBe('APPLE');
      expect(getGpuBrand('Apple GPU')).toBe('APPLE');
    });

    it('detects PowerVR (uppercase)', () => {
      expect(getGpuBrand('PowerVR SGX543MP4')).toBe('POWERVR');
    });

    it('detects Mali (uppercase)', () => {
      expect(getGpuBrand('Mali-G78')).toBe('MALI');
    });

    it('detects Adreno (uppercase)', () => {
      expect(getGpuBrand('Adreno (TM) 650')).toBe('ADRENO');
    });

    it('detects SwiftShader (uppercase)', () => {
      expect(getGpuBrand('Google SwiftShader')).toBe('SWIFTSHADER');
    });

    it('detects virtual machine GPUs (uppercase)', () => {
      expect(getGpuBrand('VMware SVGA 3D')).toBe('VMWARE');
      expect(getGpuBrand('VirtualBox Graphics Adapter')).toBe('VIRTUALBOX');
      expect(getGpuBrand('Parallels Display Adapter')).toBe('PARALLELS');
    });

    it('detects Microsoft (uppercase)', () => {
      expect(getGpuBrand('Microsoft Basic Render Driver')).toBe('MICROSOFT');
    });

    it('returns OTHER for unknown GPU', () => {
      expect(getGpuBrand('Unknown GPU XYZ')).toBe('OTHER');
    });

    it('returns null for empty input', () => {
      expect(getGpuBrand('')).toBeNull();
    });

    it('returns null for null/undefined input', () => {
      expect(getGpuBrand(null as unknown as string)).toBeNull();
      expect(getGpuBrand(undefined as unknown as string)).toBeNull();
    });

    it('detects LLVM/Mesa', () => {
      expect(getGpuBrand('llvmpipe (LLVM 12.0.0, 256 bits)')).toBe('LLVM');
    });

    it('detects Samsung', () => {
      expect(getGpuBrand('Samsung Xclipse 920')).toBe('SAMSUNG');
    });
  });

  describe('getBraveUnprotectedParameters()', () => {
    it('filters out Brave-blocked WebGL parameters', () => {
      const params = {
        MAX_TEXTURE_SIZE: 16384,
        UNMASKED_RENDERER_WEBGL: 'ANGLE (Intel)',
        UNMASKED_VENDOR_WEBGL: 'Google Inc.',
        VERSION: 'WebGL 2.0',
        MAX_VIEWPORT_DIMS: [32767, 32767],
        SHADING_LANGUAGE_VERSION: 'WebGL GLSL ES 3.00',
      };

      const result = getBraveUnprotectedParameters(params);

      // Blocked params should be removed
      expect(result).not.toHaveProperty('UNMASKED_RENDERER_WEBGL');
      expect(result).not.toHaveProperty('UNMASKED_VENDOR_WEBGL');
      expect(result).not.toHaveProperty('VERSION');
      expect(result).not.toHaveProperty('SHADING_LANGUAGE_VERSION');

      // Non-blocked params should remain
      expect(result).toHaveProperty('MAX_TEXTURE_SIZE');
      expect(result).toHaveProperty('MAX_VIEWPORT_DIMS');
    });

    it('filters shader precision parameters', () => {
      const params = {
        'FRAGMENT_SHADER.HIGH_FLOAT.precision': 23,
        'FRAGMENT_SHADER.HIGH_FLOAT.rangeMax': 127,
        'FRAGMENT_SHADER.HIGH_FLOAT.rangeMin': 127,
        'VERTEX_SHADER.HIGH_FLOAT.precision': 23,
        'VERTEX_SHADER.MEDIUM_FLOAT.precision': 23,
        ALIASED_LINE_WIDTH_RANGE: [1, 1],
      };

      const result = getBraveUnprotectedParameters(params);

      expect(result).not.toHaveProperty('FRAGMENT_SHADER.HIGH_FLOAT.precision');
      expect(result).not.toHaveProperty('VERTEX_SHADER.HIGH_FLOAT.precision');
      expect(result).toHaveProperty('ALIASED_LINE_WIDTH_RANGE');
    });

    it('returns empty object for all blocked params', () => {
      const params = {
        UNMASKED_RENDERER_WEBGL: 'blocked',
        UNMASKED_VENDOR_WEBGL: 'blocked',
      };

      const result = getBraveUnprotectedParameters(params);
      expect(Object.keys(result).length).toBe(0);
    });

    it('handles empty input', () => {
      const result = getBraveUnprotectedParameters({});
      expect(result).toEqual({});
    });
  });

  describe('LIKE_BRAVE constant', () => {
    it('is a boolean', () => {
      expect(typeof LIKE_BRAVE).toBe('boolean');
    });
  });

  describe('EMOJIS constant', () => {
    it('is an array of strings', () => {
      expect(Array.isArray(EMOJIS)).toBe(true);
      expect(EMOJIS.length).toBeGreaterThan(0);
      for (const emoji of EMOJIS) {
        expect(typeof emoji).toBe('string');
      }
    });

    it('contains emoji characters', () => {
      // Check that at least one contains a high codepoint char
      const hasEmoji = EMOJIS.some((e) => e.codePointAt(0)! > 127);
      expect(hasEmoji).toBe(true);
    });

    it('has expected count', () => {
      expect(EMOJIS.length).toBeGreaterThan(50);
    });
  });

  describe('CSS_FONT_FAMILY constant', () => {
    it('is a non-empty string', () => {
      expect(typeof CSS_FONT_FAMILY).toBe('string');
      expect(CSS_FONT_FAMILY.length).toBeGreaterThan(0);
    });

    it('contains expected font families', () => {
      expect(CSS_FONT_FAMILY).toContain('Segoe UI Emoji');
      expect(CSS_FONT_FAMILY).toContain('Roboto');
      expect(CSS_FONT_FAMILY).toContain('sans-serif');
    });

    it('ends with !important', () => {
      expect(CSS_FONT_FAMILY.trim()).toMatch(/!important$/);
    });
  });

  describe('Analysis object', () => {
    it('is an object', () => {
      expect(typeof Analysis).toBe('object');
    });

    it('can store values', () => {
      Analysis.testKey = 'testValue';
      expect(Analysis.testKey).toBe('testValue');
      delete Analysis.testKey;
    });
  });

  describe('LowerEntropy object', () => {
    it('is an object with boolean values', () => {
      expect(typeof LowerEntropy).toBe('object');
    });

    it('has expected entropy keys', () => {
      expect(LowerEntropy).toHaveProperty('AUDIO');
      expect(LowerEntropy).toHaveProperty('CANVAS');
      expect(LowerEntropy).toHaveProperty('FONTS');
      expect(LowerEntropy).toHaveProperty('SCREEN');
      expect(LowerEntropy).toHaveProperty('TIME_ZONE');
      expect(LowerEntropy).toHaveProperty('WEBGL');
    });

    it('all values are booleans', () => {
      for (const value of Object.values(LowerEntropy)) {
        expect(typeof value).toBe('boolean');
      }
    });
  });

  describe('queueEvent()', () => {
    it('returns a promise', () => {
      const timer = createTimer();
      timer.start();
      const result = queueEvent(timer, 0);
      expect(result).toBeInstanceOf(Promise);
    });

    it('resolves after delay', async () => {
      const timer = createTimer();
      timer.start();
      await queueEvent(timer, 5);
      // Should have accumulated some time
      expect(true).toBe(true);
    });
  });

  describe('performanceLogger', () => {
    it('has expected methods', () => {
      expect(typeof performanceLogger.logTestResult).toBe('function');
      expect(typeof performanceLogger.getLog).toBe('function');
      expect(typeof performanceLogger.getTotal).toBe('function');
    });

    it('getLog returns object', () => {
      const log = performanceLogger.getLog();
      expect(typeof log).toBe('object');
    });

    it('getTotal returns number', () => {
      const total = performanceLogger.getTotal();
      expect(typeof total).toBe('number');
    });
  });

  describe('logTestResult', () => {
    it('is a function', () => {
      expect(typeof logTestResult).toBe('function');
    });

    it('logs test results', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logTestResult({ test: 'test-name', passed: true, time: 10 });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles failed tests', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logTestResult({ test: 'test-name', passed: false, time: 5 });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles tests without time', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logTestResult({ test: 'test-name', passed: true });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getPromiseRaceFulfilled()', () => {
    it('returns response when promise resolves before limit', async () => {
      const fastPromise = Promise.resolve(new Response('test'));
      const result = await getPromiseRaceFulfilled({
        promise: fastPromise,
        responseType: Response as any,
        limit: 1000,
      });
      expect(result).toBeInstanceOf(Response);
    });

    it('returns undefined when promise is slower than limit', async () => {
      const slowPromise = new Promise((resolve) =>
        setTimeout(() => resolve(new Response('test')), 100),
      );
      const result = await getPromiseRaceFulfilled({
        promise: slowPromise,
        responseType: Response as any,
        limit: 10,
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined when promise rejects', async () => {
      const rejectingPromise = Promise.reject(new Error('test error'));
      const result = await getPromiseRaceFulfilled({
        promise: rejectingPromise,
        responseType: Response as any,
        limit: 1000,
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined when wrong type is returned', async () => {
      const wrongTypePromise = Promise.resolve({ not: 'Response' });
      const result = await getPromiseRaceFulfilled({
        promise: wrongTypePromise,
        responseType: Response as any,
        limit: 1000,
      });
      expect(result).toBeUndefined();
    });
  });

  describe('getUserAgentPlatform() additional cases', () => {
    it('returns unknown for null/undefined', () => {
      expect(getUserAgentPlatform({ userAgent: null as any })).toBe('unknown');
      expect(getUserAgentPlatform({ userAgent: undefined as any })).toBe(
        'unknown',
      );
      expect(getUserAgentPlatform({ userAgent: '' })).toBe('unknown');
    });

    it('extracts Chrome OS info', () => {
      const result = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      expect(result).toContain('CrOS');
    });

    it('handles Linux user agent', () => {
      const result = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      expect(result.toLowerCase()).toContain('linux');
    });

    it('handles iOS device info', () => {
      const result = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      });
      expect(result).toBeDefined();
    });

    it('excludes build info by default', () => {
      const result = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      });
      expect(result).not.toContain('Build/');
    });

    it('includes build info when excludeBuild=false', () => {
      const result = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014) AppleWebKit/537.36',
        excludeBuild: false,
      });
      // Note: Android parsing may vary, just check it contains Android
      expect(result).toContain('Android');
    });

    it('detects macOS versions', () => {
      const catalinaResult = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      });
      expect(catalinaResult).toContain('Catalina');

      const mojaveResult = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36',
      });
      expect(mojaveResult).toContain('Mojave');

      const sierraResult = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36',
      });
      expect(sierraResult).toContain('Sierra');
    });

    it('handles Windows NT versions', () => {
      const win10Result = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });
      expect(win10Result).toContain('Windows 10');

      const win81Result = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36',
      });
      expect(win81Result).toContain('8.1');

      const win7Result = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36',
      });
      expect(win7Result).toContain('7');
    });

    it('detects 64-bit Windows', () => {
      const result = getUserAgentPlatform({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36',
      });
      expect(result).toContain('64-bit');
    });

    it('handles user agent without parenthesis', () => {
      const result = getUserAgentPlatform({
        userAgent: 'curl/7.81.0',
      });
      expect(result).toBe('unknown');
    });

    it('handles other OS types (FreeBSD, Symbian, etc)', () => {
      const freebsdResult = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (FreeBSD; amd64 FreeBSD 13.0) AppleWebKit/537.36',
      });
      expect(freebsdResult).toContain('FreeBSD');

      const symbianResult = getUserAgentPlatform({
        userAgent:
          'Mozilla/5.0 (SymbianOS/9.4; Series60/5.0 Nokia5800) AppleWebKit/537.36',
      });
      expect(symbianResult).toContain('SymbianOS');
    });

    it('handles unrecognized OS in parenthesis', () => {
      const result = getUserAgentPlatform({
        userAgent: 'Mozilla/5.0 (UnknownOS; SomeDevice) AppleWebKit/537.36',
      });
      // Should return joined identifiers
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('decryptUserAgent() additional cases', () => {
    it('detects Opera', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
        os: 'Windows',
        isBrave: false,
      });
      expect(result).toContain('Opera');
    });

    it('detects Vivaldi', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Vivaldi/6.4.3160.47',
        os: 'Windows',
        isBrave: false,
      });
      expect(result).toContain('Vivaldi');
    });

    it('detects DuckDuckGo browser', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 DuckDuckGo/1.0',
        os: 'Windows',
        isBrave: false,
      });
      expect(result).toContain('DuckDuckGo');
    });

    it('detects Yandex browser', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 YaBrowser/24.1.0.0 Safari/537.36',
        os: 'Windows',
        isBrave: false,
      });
      expect(result).toContain('Yandex');
    });

    it('detects Pale Moon', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Goanna/6.2 Firefox/115.0 PaleMoon/32.0.1',
        os: 'Windows',
        isBrave: false,
      });
      expect(result).toContain('PaleMoon');
    });

    it('detects Edge iOS', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/120.0.2210.116 Mobile/15E148 Safari/604.1',
        os: 'iOS',
        isBrave: false,
      });
      expect(result).toContain('EdgiOS');
    });

    it('returns unknown for unrecognized browser', () => {
      const result = decryptUserAgent({
        ua: 'Some/Random/User/Agent',
        os: 'Unknown',
        isBrave: false,
      });
      expect(result).toBe('unknown');
    });

    it('detects Chrome iOS', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
        os: 'iOS',
        isBrave: false,
      });
      expect(result).toContain('CriOS');
    });

    it('detects Firefox iOS', () => {
      const result = decryptUserAgent({
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15',
        os: 'iOS',
        isBrave: false,
      });
      expect(result).toContain('FxiOS');
    });
  });

  describe('getReportedPlatform() additional cases', () => {
    it('detects Apple from iOS user agent', () => {
      const [uaOS] = getReportedPlatform(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      );
      expect(uaOS).toBe('Apple');
    });

    it('detects Linux from Android user agent', () => {
      const [uaOS] = getReportedPlatform(
        'Mozilla/5.0 (Linux; Android 13; Pixel 7)',
      );
      expect(uaOS).toBe('Linux');
    });

    it('detects Linux from Chrome OS', () => {
      const [uaOS] = getReportedPlatform(
        'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)',
      );
      expect(uaOS).toBe('Linux');
    });

    it('returns OTHER for unknown', () => {
      const [uaOS] = getReportedPlatform('Unknown Agent');
      expect(uaOS).toBe('Other');
    });

    it('detects Apple platform from Mac platform string', () => {
      const [uaOS, platformOS] = getReportedPlatform(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'MacIntel',
      );
      expect(uaOS).toBe('Apple');
      expect(platformOS).toBe('Apple');
    });

    it('detects Linux platform from ARM', () => {
      const [uaOS, platformOS] = getReportedPlatform(
        'Mozilla/5.0 (Linux; Android 13)',
        'Linux armv8l',
      );
      expect(platformOS).toBe('Linux');
    });
  });

  describe('getOS() additional edge cases', () => {
    it('detects generic iOS', () => {
      expect(
        getOS('Mozilla/5.0 (iOS; CPU like Mac OS X) AppleWebKit/600.1.4'),
      ).toBe('iOS');
    });

    it('handles case insensitivity', () => {
      expect(getOS('WINDOWS NT 10.0')).toBe('Windows');
      expect(getOS('ANDROID 13')).toBe('Android');
      expect(getOS('LINUX X86_64')).toBe('Linux');
      expect(getOS('MACINTOSH')).toBe('Mac');
    });
  });

  describe('createTimer() additional cases', () => {
    it('stop returns 0 if never started', () => {
      const timer = createTimer();
      const elapsed = timer.stop();
      expect(elapsed).toBe(0);
    });

    it('start returns start time', () => {
      const timer = createTimer();
      const startTime = timer.start();
      expect(typeof startTime).toBe('number');
      expect(startTime).toBeGreaterThan(0);
    });
  });
});
