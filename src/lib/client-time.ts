export function getClientDateTimePayload() {
  const now = new Date();
  return {
    clientDateTime: now.toISOString(),
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    clientTimeZoneOffsetMinutes: -now.getTimezoneOffset(),
  };
}
