// update.js — check GitHub Releases for a newer version of this extension.
//
// Unpacked extensions cannot update themselves, so this only reports whether a
// newer release exists and where its ZIP can be downloaded.

export const GITHUB_REPO = "paulchi-intel/speech-to-text-remote";
export const UPDATE_CHECK_CACHE_KEY = "speechToTextUpdateCheck";
export const UPDATE_CHECK_CACHE_MS = 6 * 60 * 60 * 1000;
// "No release found" is cached only briefly, so a repo that was private or had no
// release yet is noticed soon after it becomes public or publishes one.
export const UPDATE_CHECK_NEGATIVE_CACHE_MS = 10 * 60 * 1000;

export function normalizeReleaseVersion(value) {
  const version = String(value || "").trim().replace(/^v/i, "");
  return /^\d+(?:\.\d+){0,3}$/.test(version) ? version : null;
}

export function compareVersions(left, right) {
  const leftParts = String(left || "").split(".").map(Number);
  const rightParts = String(right || "").split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length, 4);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function formatResult(release, repo, currentVersion) {
  const latestVersion = normalizeReleaseVersion(release?.latestVersion);
  return {
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(latestVersion && compareVersions(latestVersion, currentVersion) > 0),
    releaseUrl: release?.releaseUrl || `https://github.com/${repo}/releases/latest`,
    assetUrl: release?.assetUrl || null,
    publishedAt: release?.publishedAt || null
  };
}

// Returns { currentVersion, latestVersion, updateAvailable, releaseUrl, assetUrl, publishedAt }.
// Results (including "no release yet") are cached for six hours unless force is set.
export async function checkExtensionUpdate({
  force = false,
  repo = GITHUB_REPO,
  currentVersion = chrome.runtime.getManifest().version,
  now = Date.now(),
  fetchImpl = fetch,
  storage = chrome.storage.local
} = {}) {
  const stored = await storage.get(UPDATE_CHECK_CACHE_KEY);
  const cached = stored[UPDATE_CHECK_CACHE_KEY];
  const cacheMs = cached?.latestVersion ? UPDATE_CHECK_CACHE_MS : UPDATE_CHECK_NEGATIVE_CACHE_MS;
  if (!force && cached && cached.repo === repo && now - Number(cached.checkedAt || 0) < cacheMs) {
    return formatResult(cached, repo, currentVersion);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal
    });

    let release;
    if (response.status === 404) {
      // No published release yet, or the repo is private: nothing to offer.
      release = { repo, checkedAt: now, latestVersion: null };
    } else if (!response.ok) {
      throw new Error(`GitHub release request failed (${response.status})`);
    } else {
      const data = await response.json();
      const zip = (data.assets || []).find((a) => /\.zip$/i.test(a.name || ""));
      release = {
        repo,
        checkedAt: now,
        latestVersion: normalizeReleaseVersion(data.tag_name),
        releaseUrl: data.html_url || `https://github.com/${repo}/releases/latest`,
        assetUrl: zip?.browser_download_url || null,
        publishedAt: data.published_at || null
      };
    }
    await storage.set({ [UPDATE_CHECK_CACHE_KEY]: release });
    return formatResult(release, repo, currentVersion);
  } catch (error) {
    if (cached) return formatResult(cached, repo, currentVersion);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
