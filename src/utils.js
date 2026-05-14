// Generate a random short code
function generateShortCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Validate URL format
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Validate custom alias format (alphanumeric and hyphens, 1-30 chars)
function isValidAlias(alias) {
  const aliasRegex = /^[a-zA-Z0-9-]{1,30}$/;
  return aliasRegex.test(alias);
}

module.exports = {
  generateShortCode,
  isValidUrl,
  isValidAlias,
};
