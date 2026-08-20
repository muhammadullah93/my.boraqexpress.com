import { integrationConfigured } from '../config.js';
import { ApiError } from '../utils.js';

const supported = new Set(['shopee', 'tiktok', 'lazada']);

export function marketplaceStatus(platform) {
  if (!supported.has(platform)) throw new ApiError(404, 'PLATFORM_NOT_SUPPORTED', 'Marketplace is not supported.');
  return {
    platform,
    credentialsConfigured: integrationConfigured(platform),
    adapterStatus: integrationConfigured(platform) ? 'credentials_detected' : 'not_configured'
  };
}

export async function syncMarketplace(platform) {
  const status = marketplaceStatus(platform);
  if (!status.credentialsConfigured) {
    throw new ApiError(
      409,
      'INTEGRATION_NOT_CONFIGURED',
      `${platform} API credentials are not configured. Official marketplace approval is required before live synchronization.`
    );
  }
  throw new ApiError(
    501,
    'CONNECTOR_ACTIVATION_REQUIRED',
    `${platform} credentials were detected, but the production connector must be activated against the approved seller app and callback URLs.`
  );
}
