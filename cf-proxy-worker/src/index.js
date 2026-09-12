export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, env.ORIGIN_URL);

    const init = {
      method: request.method,
      headers: request.headers,
      body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body,
      redirect: 'manual',
    };

    return fetch(target.toString(), init);
  },
};
