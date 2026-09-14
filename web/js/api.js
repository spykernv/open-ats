/** Thin fetch wrapper: JSON in, JSON out, server error messages preserved. */
export async function api(pathname, options = {}) {
  const res = await fetch(pathname, options);
  const type = res.headers.get("content-type") || "";
  const body = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && body.error) || body || `HTTP ${res.status}`);
  return body;
}

export function postJson(pathname, data) {
  return api(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data || {}),
  });
}
