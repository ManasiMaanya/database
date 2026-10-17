/* =====================================================================
   Small fetch wrapper around the Surgical Scheduling REST API.
   Holds the JWT in localStorage and attaches it to every request.
   ===================================================================== */
const API = (() => {
  const TOKEN_KEY = 'ssdm.token';
  let token = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    token = null;
  }

  function setToken(next) {
    token = next || null;
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      /* storage can be blocked; the in-memory token still works */
    }
  }

  async function request(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;

    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (networkError) {
      const err = new Error('Cannot reach the server. Is the backend running?');
      err.status = 0;
      throw err;
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { error: text };
      }
    }

    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed (' + res.status + ')');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    hasToken: () => !!token,
    setToken,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
    login: (email, password) => request('POST', '/auth/login', { email, password }),
    register: (body) => request('POST', '/auth/register', body),
    bootstrap: () => request('GET', '/bootstrap'),
  };
})();
