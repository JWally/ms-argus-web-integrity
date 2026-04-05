/**
 * Plugin Validation
 *
 * Validates browser plugins and mimeTypes for tampering. Plugins and mimeTypes
 * have cross-references that should be consistent. If a plugin claims to support
 * a mimeType that doesn't exist, or vice versa, tampering is detected.
 *
 * @module lies/plugins
 */

import type { PluginLiesResult } from './types';

/**
 * Validates browser plugins and mimeTypes for tampering.
 *
 * @param plugins - Browser's PluginArray
 * @param mimeTypes - Browser's MimeTypeArray
 * @returns Validated plugins/mimeTypes and any detected lies
 */
export function getPluginLies(
  plugins: PluginArray,
  mimeTypes: MimeTypeArray,
): PluginLiesResult {
  const lies: string[] = [];
  const pluginsOwnPropertyNames = Object.getOwnPropertyNames(plugins).filter(
    (name) => isNaN(+name),
  );
  const mimeTypesOwnPropertyNames = Object.getOwnPropertyNames(
    mimeTypes,
  ).filter((name) => isNaN(+name));

  // Cast to arrays for easier processing
  const pluginsList = [...plugins] as Plugin[];
  const mimeTypesList = [...mimeTypes] as MimeType[];

  // Get initial trusted mimeType names
  const trustedMimeTypes = new Set(mimeTypesOwnPropertyNames);

  // Get initial trusted plugin names
  /** Removes duplicate values from an array. */
  const excludeDuplicates = <T>(arr: T[]): T[] => [...new Set(arr)];
  const mimeTypeEnabledPlugins = excludeDuplicates(
    mimeTypesList.map((mimeType) => mimeType.enabledPlugin),
  );
  const trustedPluginNames = new Set(pluginsOwnPropertyNames);
  const mimeTypeEnabledPluginsNames = mimeTypeEnabledPlugins.map(
    (plugin) => plugin && plugin.name,
  );
  const trustedPluginNamesArray = [...trustedPluginNames];

  trustedPluginNamesArray.forEach((name) => {
    const validName = new Set(mimeTypeEnabledPluginsNames).has(name);
    if (!validName) {
      trustedPluginNames.delete(name);
    }
  });

  // Check 1: Each plugin should contain valid MimeType objects
  const invalidPlugins = pluginsList.filter((plugin) => {
    try {
      const validMimeType =
        Object.getPrototypeOf(plugin[0]).constructor.name === 'MimeType';
      if (!validMimeType) {
        trustedPluginNames.delete(plugin.name);
      }
      return !validMimeType;
    } catch (error) {
      trustedPluginNames.delete(plugin.name);
      return true; // Sign of tampering
    }
  });

  if (invalidPlugins.length) {
    lies.push('missing mimetype');
  }

  // Check 2: Each plugin's mimeTypes should be in the global mimeTypes list
  const pluginMimeTypes = pluginsList
    .map((plugin) => Object.values(plugin))
    .flat();
  const pluginMimeTypesNames = pluginMimeTypes.map(
    (mimetype) => (mimetype as MimeType).type,
  );

  pluginMimeTypesNames.forEach((name) => {
    const validName = trustedMimeTypes.has(name);
    if (!validName) {
      trustedMimeTypes.delete(name);
    }
  });

  pluginsList.forEach((plugin) => {
    const mimeTypes = Object.values(plugin).map((mimetype) => mimetype.type);
    mimeTypes.forEach((mimetype) => {
      if (!trustedMimeTypes.has(mimetype)) {
        lies.push('invalid mimetype');
        trustedPluginNames.delete(plugin.name);
      }
    });
  });

  return {
    validPlugins: pluginsList.filter((plugin) =>
      trustedPluginNames.has(plugin.name),
    ),
    validMimeTypes: mimeTypesList.filter((mimeType) =>
      trustedMimeTypes.has(mimeType.type),
    ),
    lies: [...new Set(lies)], // Remove duplicates
  };
}
