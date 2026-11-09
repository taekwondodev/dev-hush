export function isHushProviderAlert(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  return /usage[_ -]?limit|insufficient[_ -]?quota|quota.{0,40}(exceeded|exhausted)|(?:exceeded|exhausted).{0,40}quota|out of (?:budget|credits)|credit balance|available balance|billing|rate[_ -]?limit|\b429\b|connection (?:error|refused|failed|reset)|connect(?:ion)? timeout|fetch failed|network (?:error|unreachable)|econnrefused|econnreset|enotfound|etimedout|ehostunreach|service.?unavailable|overloaded|upstream.?connect|\b50[0234]\b|timed out|websocket (?:error|closed)/i.test(errorMessage);
}
