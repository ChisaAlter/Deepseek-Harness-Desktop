function apiUrl(origin, path) {
  return `${String(origin || '').replace(/\/$/, '')}${path}`;
}

async function loginWithOffer({ fetchImpl, origin, offer }) {
  const token = String(offer?.token || '');
  if (!token) {
    throw new Error('配对链接里没有密钥');
  }
  const fetchFn = fetchImpl || globalThis.fetch;
  const response = await fetchFn(apiUrl(origin, '/__remote__/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(token)}`,
    credentials: 'include',
    redirect: 'manual',
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('配对密钥无效');
  }
  if (response.status >= 400) {
    throw new Error(`登录失败（${response.status}）`);
  }
}

export { loginWithOffer };
